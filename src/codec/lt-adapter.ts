import type {
  FountainEncoder,
  FountainDecoder,
  FountainCodecFactory,
  DecodeStatus,
} from "./types";

/**
 * Seeded PRNG (xorshift128+) for deterministic symbol generation.
 */
class PRNG {
  private s0: number;
  private s1: number;

  constructor(seed: number) {
    this.s0 = seed | 0 || 1;
    this.s1 = (seed >>> 16) ^ 0x6d2b79f5 || 1;
  }

  next(): number {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >>> 17;
    s1 ^= s0;
    s1 ^= s0 >>> 26;
    this.s1 = s1;
    return (this.s0 + this.s1) >>> 0;
  }

  /** Returns a float in [0, 1) */
  nextFloat(): number {
    return this.next() / 0x100000000;
  }
}

/**
 * Robust Soliton Distribution for LT codes.
 * Parameters: c=0.1, delta=0.5 as specified in design.
 */
function robustSolitonDegree(k: number, rng: PRNG): number {
  const c = 0.1;
  const delta = 0.5;
  const s = c * Math.sqrt(k) * Math.log(k / delta);
  const ks = Math.round(k / s);

  // Build CDF (ideal + robust component)
  const cdf: number[] = [];
  let total = 0;

  for (let d = 1; d <= k; d++) {
    // Ideal Soliton
    let rho: number;
    if (d === 1) {
      rho = 1 / k;
    } else {
      rho = 1 / (d * (d - 1));
    }

    // Robust component (tau)
    let tau: number;
    if (d >= 1 && d <= ks - 1) {
      tau = s / (k * d);
    } else if (d === ks) {
      tau = (s * Math.log(s / delta)) / k;
    } else {
      tau = 0;
    }

    total += rho + tau;
    cdf.push(total);
  }

  // Normalize and sample
  const r = rng.nextFloat() * total;
  for (let d = 0; d < cdf.length; d++) {
    if (r < cdf[d]) return d + 1;
  }
  return 1;
}

/**
 * Select source block indices for a given symbol using deterministic PRNG.
 */
function selectBlocks(
  symbolId: number,
  k: number,
  baseSeed: number,
): number[] {
  const rng = new PRNG(baseSeed ^ (symbolId * 2654435761));
  const degree = robustSolitonDegree(k, rng);
  const blocks = new Set<number>();

  while (blocks.size < Math.min(degree, k)) {
    blocks.add(rng.next() % k);
  }

  return Array.from(blocks);
}

/**
 * XOR two Uint8Arrays in place (a ^= b).
 */
function xorInPlace(a: Uint8Array, b: Uint8Array): void {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    a[i] ^= b[i];
  }
}

export class LTFountainEncoder implements FountainEncoder {
  private blocks: Uint8Array[] = [];
  private blockSize = 0;
  private baseSeed = 0;

  init(data: Uint8Array, blockSize: number): void {
    this.blockSize = blockSize;
    this.blocks = [];
    // Use fixed baseSeed=0 so encoder and decoder always agree.
    // Symbol ID already provides sufficient randomization via PRNG(symbolId * 2654435761).
    this.baseSeed = 0;

    const k = Math.ceil(data.length / blockSize);
    for (let i = 0; i < k; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, data.length);
      const block = new Uint8Array(blockSize);
      block.set(data.subarray(start, end));
      this.blocks.push(block);
    }
  }

  encode(symbolId: number): Uint8Array {
    const indices = selectBlocks(
      symbolId,
      this.blocks.length,
      this.baseSeed,
    );
    const symbol = new Uint8Array(this.blockSize);
    for (const idx of indices) {
      xorInPlace(symbol, this.blocks[idx]);
    }
    return symbol;
  }

  getSourceBlockCount(): number {
    return this.blocks.length;
  }

  free(): void {
    this.blocks = [];
  }
}

interface ReceivedSymbol {
  data: Uint8Array;
  blocks: Set<number>;
}

export class LTFountainDecoder implements FountainDecoder {
  private messageLength = 0;
  private blockSize = 0;
  private k = 0;
  private symbols: ReceivedSymbol[] = [];
  private decoded: (Uint8Array | null)[] = [];
  private decodedCount = 0;
  private isComplete = false;
  private baseSeed = 0;

  init(messageLength: number, blockSize: number): void {
    this.messageLength = messageLength;
    this.blockSize = blockSize;
    this.k = Math.ceil(messageLength / blockSize);
    this.symbols = [];
    this.decoded = new Array(this.k).fill(null);
    this.decodedCount = 0;
    this.isComplete = false;
    this.baseSeed = 0; // Will be set from first symbol
  }

  setBaseSeed(seed: number): void {
    this.baseSeed = seed;
  }

  addSymbol(symbolId: number, data: Uint8Array): DecodeStatus {
    if (this.isComplete) return { kind: "complete" };

    const indices = selectBlocks(symbolId, this.k, this.baseSeed);
    const blocks = new Set(indices);
    const symbolData = new Uint8Array(data);

    // Remove already-decoded blocks
    for (const idx of Array.from(blocks)) {
      if (this.decoded[idx] !== null) {
        xorInPlace(symbolData, this.decoded[idx]!);
        blocks.delete(idx);
      }
    }

    if (blocks.size === 0) {
      // Redundant symbol
      return {
        kind: "need_more",
        received: this.decodedCount,
        needed: this.k,
      };
    }

    if (blocks.size === 1) {
      // Directly decode this block
      const idx = blocks.values().next().value!;
      this.decoded[idx] = symbolData;
      this.decodedCount++;
      // Propagate: try to reduce other stored symbols
      this.propagate(idx);
    } else {
      // Store for later reduction
      this.symbols.push({ data: symbolData, blocks });
    }

    if (this.decodedCount === this.k) {
      this.isComplete = true;
      return { kind: "complete" };
    }

    return {
      kind: "need_more",
      received: this.decodedCount,
      needed: this.k,
    };
  }

  private propagate(startIdx: number): void {
    const queue = [startIdx];

    while (queue.length > 0) {
      const decodedIdx = queue.shift()!;
      const remaining: ReceivedSymbol[] = [];

      for (const sym of this.symbols) {
        if (sym.blocks.has(decodedIdx)) {
          xorInPlace(sym.data, this.decoded[decodedIdx]!);
          sym.blocks.delete(decodedIdx);
        }

        if (sym.blocks.size === 1) {
          const idx = sym.blocks.values().next().value!;
          if (this.decoded[idx] === null) {
            this.decoded[idx] = sym.data;
            this.decodedCount++;
            queue.push(idx);
            if (this.decodedCount === this.k) {
              this.isComplete = true;
              this.symbols = [];
              return;
            }
          }
          // Don't keep degree-1 symbols that resolved
        } else if (sym.blocks.size > 1) {
          remaining.push(sym);
        }
        // Drop degree-0 symbols
      }

      this.symbols = remaining;
    }
  }

  recover(): Uint8Array {
    if (!this.isComplete) throw new Error("Decode not complete");
    const result = new Uint8Array(this.messageLength);
    for (let i = 0; i < this.k; i++) {
      const block = this.decoded[i];
      if (!block) throw new Error(`Block ${i} not decoded`);
      const start = i * this.blockSize;
      const len = Math.min(this.blockSize, this.messageLength - start);
      result.set(block.subarray(0, len), start);
    }
    return result;
  }

  free(): void {
    this.symbols = [];
    this.decoded = [];
  }
}

export class LTCodecFactory implements FountainCodecFactory {
  createEncoder(): Promise<FountainEncoder> {
    return Promise.resolve(new LTFountainEncoder());
  }

  createDecoder(): Promise<FountainDecoder> {
    return Promise.resolve(new LTFountainDecoder());
  }

  isWasmAvailable(): boolean {
    return false;
  }
}