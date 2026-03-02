// @ts-expect-error - wirehair-wasm d.ts only exports header-wrapped versions, we need Raw
import { WirehairEncoderRaw, WirehairDecoderRaw, Wirehair_Success } from "wirehair-wasm/dist/wirehair.mjs";
import type {
  FountainEncoder,
  FountainDecoder,
  FountainCodecFactory,
  DecodeStatus,
} from "./types";

export class WirehairFountainEncoder implements FountainEncoder {
  private encoder: InstanceType<typeof WirehairEncoderRaw> | null = null;
  private sourceBlocks = 0;

  async create(): Promise<void> {
    this.encoder = await WirehairEncoderRaw.create();
  }

  init(data: Uint8Array, blockSize: number): void {
    if (!this.encoder) throw new Error("Encoder not created");
    this.encoder.setMessage(data, blockSize);
    this.sourceBlocks = Math.ceil(data.length / blockSize);
  }

  encode(symbolId: number): Uint8Array {
    if (!this.encoder) throw new Error("Encoder not initialized");
    const raw = this.encoder.encode(symbolId);
    return new Uint8Array(raw);
  }

  getSourceBlockCount(): number {
    return this.sourceBlocks;
  }

  free(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
    }
  }
}

export class WirehairFountainDecoder implements FountainDecoder {
  private decoder: InstanceType<typeof WirehairDecoderRaw> | null = null;
  private received = 0;
  private needed = 0;
  private complete = false;

  async create(): Promise<void> {
    this.decoder = await WirehairDecoderRaw.create();
  }

  init(messageLength: number, blockSize: number): void {
    if (!this.decoder) throw new Error("Decoder not created");
    this.decoder.init(messageLength, blockSize);
    this.needed = Math.ceil(messageLength / blockSize);
    this.received = 0;
    this.complete = false;
  }

  addSymbol(symbolId: number, data: Uint8Array): DecodeStatus {
    if (!this.decoder) throw new Error("Decoder not initialized");
    if (this.complete) return { kind: "complete" };

    const result = this.decoder.decode(symbolId, data);
    if (result === false) {
      return { kind: "need_more", received: this.received, needed: this.needed };
    }

    this.received++;
    if (result === Wirehair_Success) {
      this.complete = true;
      return { kind: "complete" };
    }

    return { kind: "need_more", received: this.received, needed: this.needed };
  }

  recover(): Uint8Array {
    if (!this.decoder) throw new Error("Decoder not initialized");
    if (!this.complete) throw new Error("Decode not complete");
    return this.decoder.recover();
  }

  free(): void {
    if (this.decoder) {
      this.decoder.free();
      this.decoder = null;
    }
  }
}

export class WirehairCodecFactory implements FountainCodecFactory {
  private wasmAvailable: boolean | null = null;

  async createEncoder(): Promise<FountainEncoder> {
    const enc = new WirehairFountainEncoder();
    await enc.create();
    return enc;
  }

  async createDecoder(): Promise<FountainDecoder> {
    const dec = new WirehairFountainDecoder();
    await dec.create();
    return dec;
  }

  isWasmAvailable(): boolean {
    if (this.wasmAvailable === null) {
      try {
        this.wasmAvailable =
          typeof WebAssembly !== "undefined" &&
          typeof WebAssembly.validate === "function";
      } catch {
        this.wasmAvailable = false;
      }
    }
    return this.wasmAvailable;
  }
}
