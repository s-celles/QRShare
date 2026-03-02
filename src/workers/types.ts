import type { EncodingPreset } from "@/qr/renderer";

// Main thread -> Encode Worker messages
export type EncodeWorkerInput =
  | { type: "start"; file: ArrayBuffer; filename: string; preset: EncodingPreset }
  | { type: "set_fps"; fps: number }
  | { type: "stop" };

// Encode Worker -> Main thread messages
export type EncodeWorkerOutput =
  | { type: "metadata"; totalBlocks: number; fileSize: number; sha256: string }
  | { type: "frame"; frameBytes: ArrayBuffer; symbolId: number; frameNumber: number }
  | { type: "error"; message: string };

// Main thread -> Decode Worker messages
export type DecodeWorkerInput =
  | { type: "frame"; imageData: ImageData }
  | { type: "stop" };

// Decode Worker -> Main thread messages
export type DecodeWorkerOutput =
  | { type: "progress"; uniqueSymbols: number; neededSymbols: number; metadataHash: string }
  | { type: "metadata"; filename: string; fileSize: number }
  | { type: "complete"; file: ArrayBuffer; filename: string; sha256: string; verified: boolean }
  | { type: "error"; message: string };
