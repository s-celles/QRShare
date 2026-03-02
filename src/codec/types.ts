export type DecodeStatus =
  | { kind: "need_more"; received: number; needed: number }
  | { kind: "complete" };

export interface FountainEncoder {
  init(data: Uint8Array, blockSize: number): void;
  encode(symbolId: number): Uint8Array;
  getSourceBlockCount(): number;
  free(): void;
}

export interface FountainDecoder {
  init(messageLength: number, blockSize: number): void;
  addSymbol(symbolId: number, data: Uint8Array): DecodeStatus;
  recover(): Uint8Array;
  free(): void;
}

export interface FountainCodecFactory {
  createEncoder(): Promise<FountainEncoder>;
  createDecoder(): Promise<FountainDecoder>;
  isWasmAvailable(): boolean;
}
