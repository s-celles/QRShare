import { describe, expect, it } from "bun:test";
import { crc32, crc32Update, CRC32_INIT, crc32Final } from "@/audio/crc32";
import { rsEncode, rsDecode, gfMul, gfDiv, gfPow, gfInverse } from "@/audio/reed-solomon";
import { fft, ifft } from "@/audio/fft";
import { goertzelPower } from "@/audio/goertzel";
import { prng, randomBytes } from "./helpers";

describe("crc32 (REQ-AUD-070)", () => {
  it("matches the IEEE check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("incremental updates equal one-shot computation", () => {
    const data = randomBytes(1000, 42);
    let state = CRC32_INIT;
    state = crc32Update(state, data.subarray(0, 333));
    state = crc32Update(state, data.subarray(333, 334));
    state = crc32Update(state, data.subarray(334));
    expect(crc32Final(state)).toBe(crc32(data));
  });
});

describe("GF(256) arithmetic", () => {
  it("multiplies and divides consistently", () => {
    for (let a = 1; a < 256; a += 7) {
      for (let b = 1; b < 256; b += 11) {
        expect(gfDiv(gfMul(a, b), b)).toBe(a);
      }
      expect(gfMul(a, gfInverse(a))).toBe(1);
    }
    expect(gfMul(0, 5)).toBe(0);
    expect(gfPow(2, 8)).toBe(0x1d); // x^8 = x^4+x^3+x^2+1 mod 0x11d
  });
});

function corrupt(cw: Uint8Array, positions: number[], rand: () => number): Uint8Array {
  const out = new Uint8Array(cw);
  for (const p of positions) out[p] ^= 1 + Math.floor(rand() * 255);
  return out;
}

function pickPositions(n: number, count: number, rand: () => number): number[] {
  const set = new Set<number>();
  while (set.size < count) set.add(Math.floor(rand() * n));
  return [...set];
}

describe("Reed-Solomon encoder (REQ-AUD-070)", () => {
  it("is systematic and yields a zero-syndrome codeword", () => {
    const msg = randomBytes(40, 1);
    const cw = rsEncode(msg, 16);
    expect(cw.length).toBe(56);
    expect(cw.subarray(0, 40)).toEqual(msg);
    const res = rsDecode(cw, 16);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual(msg);
      expect(res.corrected).toBe(0);
    }
  });

  it("rejects codewords longer than 255", () => {
    expect(() => rsEncode(new Uint8Array(250), 16)).toThrow();
  });
});

describe("Reed-Solomon decoder (REQ-AUD-074)", () => {
  const rand = prng(1234);

  it("corrects up to nsym/2 errors", () => {
    for (let trial = 0; trial < 200; trial++) {
      const nsym = [4, 12, 16][trial % 3];
      const msg = randomBytes(3 + (trial % 120), trial);
      const cw = rsEncode(msg, nsym);
      const nErr = Math.floor(rand() * (nsym / 2 + 1));
      const bad = corrupt(cw, pickPositions(cw.length, nErr, rand), rand);
      const res = rsDecode(bad, nsym);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual(msg);
        expect(res.corrected).toBe(nErr);
      }
    }
  });

  it("corrects up to nsym erasures", () => {
    for (let trial = 0; trial < 200; trial++) {
      const nsym = [4, 12, 16][trial % 3];
      const msg = randomBytes(5 + (trial % 100), trial + 1000);
      const cw = rsEncode(msg, nsym);
      const pos = pickPositions(cw.length, Math.floor(rand() * (nsym + 1)), rand);
      const bad = corrupt(cw, pos, rand);
      const res = rsDecode(bad, nsym, pos);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data).toEqual(msg);
    }
  });

  it("corrects mixed errors and erasures with 2e + f <= nsym", () => {
    for (let trial = 0; trial < 300; trial++) {
      const nsym = 16;
      const msg = randomBytes(10 + (trial % 150), trial + 5000);
      const cw = rsEncode(msg, nsym);
      const f = Math.floor(rand() * (nsym + 1));
      const e = Math.floor(rand() * (Math.floor((nsym - f) / 2) + 1));
      const all = pickPositions(cw.length, e + f, rand);
      const erasures = all.slice(0, f);
      const bad = corrupt(cw, all, rand);
      const res = rsDecode(bad, nsym, erasures);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data).toEqual(msg);
    }
  });

  it("tolerates erasure positions that are actually correct", () => {
    const msg = randomBytes(50, 9);
    const cw = rsEncode(msg, 16);
    const res = rsDecode(cw, 16, [0, 5, 10, 60]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(msg);
  });

  it("fails (or miscorrects only rarely) beyond capacity; never silently in most cases", () => {
    // Seeded fuzz of 10k cases beyond capacity. Bounded-distance decoding may land on another
    // codeword; we count those miscorrections — the packet layer's CRC32 must catch them.
    let failures = 0;
    let miscorrections = 0;
    let silentlyCorrect = 0;
    const r = prng(99);
    for (let trial = 0; trial < 10000; trial++) {
      const nsym = 16;
      const msg = randomBytes(40, trial + 20000);
      const cw = rsEncode(msg, nsym);
      const nErr = nsym / 2 + 1 + Math.floor(r() * 8);
      const bad = corrupt(cw, pickPositions(cw.length, nErr, r), r);
      const res = rsDecode(bad, nsym);
      if (!res.ok) failures++;
      else if (bytesEqual(res.data, msg)) silentlyCorrect++;
      else miscorrections++;
    }
    expect(silentlyCorrect).toBe(0);
    expect(failures + miscorrections).toBe(10000);
    // With 16 parity symbols the miscorrection probability is tiny (≈ 1/8! ≈ 2.5e-5 per word).
    expect(miscorrections).toBeLessThan(10);
  });

  it("rejects more erasures than parity", () => {
    const cw = rsEncode(randomBytes(10, 1), 4);
    expect(rsDecode(cw, 4, [0, 1, 2, 3, 4]).ok).toBe(false);
  });
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function naiveDft(re: Float64Array, im: Float64Array): [Float64Array, Float64Array] {
  const n = re.length;
  const or = new Float64Array(n);
  const oi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
    or[k] = sr;
    oi[k] = si;
  }
  return [or, oi];
}

describe("fft (REQ-AUD-055)", () => {
  it("matches a naive DFT for sizes 8..4096", () => {
    const r = prng(3);
    for (let n = 8; n <= 4096; n *= 2) {
      const re = new Float64Array(n).map(() => r() * 2 - 1);
      const im = new Float64Array(n).map(() => r() * 2 - 1);
      const [er, ei] = n <= 1024 ? naiveDft(re, im) : [null, null];
      const fr = new Float64Array(re);
      const fi = new Float64Array(im);
      fft(fr, fi);
      if (er && ei) {
        for (let k = 0; k < n; k++) {
          expect(Math.abs(fr[k] - er[k])).toBeLessThan(1e-8 * n);
          expect(Math.abs(fi[k] - ei[k])).toBeLessThan(1e-8 * n);
        }
      }
      ifft(fr, fi);
      for (let k = 0; k < n; k++) {
        expect(Math.abs(fr[k] - re[k])).toBeLessThan(1e-9);
        expect(Math.abs(fi[k] - im[k])).toBeLessThan(1e-9);
      }
    }
  });

  it("rejects non power-of-two sizes", () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow();
  });
});

describe("goertzel (REQ-AUD-055, REQ-AUD-056)", () => {
  const sr = 44100;
  const n = Math.round(0.04 * sr);
  const tone = (f: number, amp: number) => {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr + 0.3);
    return x;
  };

  it("finds the right tone among 16 at fractional frequencies", () => {
    const base = 1500;
    const df = 50;
    for (let v = 0; v < 16; v++) {
      const x = tone(base + v * df, 0.5);
      let best = -1;
      let bestP = -1;
      for (let k = 0; k < 16; k++) {
        const p = goertzelPower(x, 0, n, base + k * df, sr);
        if (p > bestP) {
          bestP = p;
          best = k;
        }
      }
      expect(best).toBe(v);
    }
  });

  it("measures (N·A/2)² for a pure tone", () => {
    const x = tone(1537.3, 0.5);
    const p = goertzelPower(x, 0, n, 1537.3, sr);
    const expected = ((n * 0.5) / 2) ** 2;
    expect(Math.abs(p - expected) / expected).toBeLessThan(0.01);
  });

  it("is invariant to gain (ratios between tones)", () => {
    const a = tone(2000, 0.9);
    const b = tone(2000, 0.009);
    const ra = goertzelPower(a, 0, n, 2000, sr) / goertzelPower(a, 0, n, 2030, sr);
    const rb = goertzelPower(b, 0, n, 2000, sr) / goertzelPower(b, 0, n, 2030, sr);
    expect(Math.abs(Math.log10(ra) - Math.log10(rb))).toBeLessThan(1e-3);
  });
});
