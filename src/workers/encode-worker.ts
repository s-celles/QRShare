import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress } from "@/compression/compression";
import { LTCodecFactory } from "@/codec/lt-adapter";
import {
  serializeFrame,
  getFrameOverhead,
  PROTOCOL_VERSION,
  type Frame,
} from "@/protocol/frame";
import { getMaxPayloadBytes, getPresetConfig } from "@/qr/renderer";
import type { EncodingPreset } from "@/qr/renderer";
import type { EncodeWorkerInput, EncodeWorkerOutput } from "./types";

let running = false;
let currentFps = 2;

function post(msg: EncodeWorkerOutput): void {
  self.postMessage(msg);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function startEncoding(
  file: ArrayBuffer,
  filename: string,
  preset: EncodingPreset,
  userBlockSize: number,
): Promise<void> {
  running = true;

  try {
    const fileData = new Uint8Array(file);
    console.log("[encode-worker] Starting encoding, file size:", fileData.length);

    // Step 1: Hash
    const sha256Full = await hashSha256(fileData);
    const metaHash = await truncatedHash(fileData, 4);

    // Step 2: Compress
    const compressed = compress(fileData);
    console.log("[encode-worker] Compressed:", fileData.length, "->", compressed.data.length, "bytes");

    // Step 3: Compute block size
    const maxPayload = getMaxPayloadBytes(preset);
    const filenameBytes = new TextEncoder().encode(filename);
    const overhead = getFrameOverhead(filenameBytes.length);
    const maxBlockSize = Math.max(1, maxPayload - overhead);
    let blockSize = Math.min(userBlockSize, maxBlockSize);

    // Wirehair/LT requires at least 2 source blocks (k >= 2).
    const dataLen = compressed.data.length;
    if (dataLen > 0 && dataLen < blockSize * 2) {
      blockSize = Math.max(1, Math.floor(dataLen / 2));
    }

    // Step 4: Init fountain encoder
    // Always use LT codec for QR transfers to ensure cross-device compatibility.
    const factory = new LTCodecFactory();
    const encoder = await factory.createEncoder();
    encoder.init(compressed.data, blockSize);
    const k = encoder.getSourceBlockCount();
    console.log("[encode-worker] Fountain encoder ready, k:", k, "blockSize:", blockSize, "maxPayload:", maxPayload);

    // Send metadata to main thread (for sender UI stats)
    post({
      type: "metadata",
      totalBlocks: k,
      fileSize: fileData.length,
      sha256: toHex(sha256Full),
      filename,
    });

    // Step 5: Generate frames indefinitely.
    // Every frame embeds metadata (filename, fileSize, sha256) — no separate metadata frames.
    let frameNumber = 0;
    let symbolId = 0;

    while (running) {
      const symbolData = encoder.encode(symbolId);

      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: symbolId + 1, // symbolId 0 was reserved in v2, keep >= 1
        filename,
        fileSize: fileData.length,
        sha256: sha256Full,
        payload: symbolData,
      };

      const frameBytes = serializeFrame(frame);

      if (!running) break;
      const buf = new ArrayBuffer(frameBytes.byteLength);
      new Uint8Array(buf).set(frameBytes);
      post({ type: "frame", frameBytes: buf, symbolId: symbolId + 1, frameNumber });

      frameNumber++;
      symbolId++;

      // Pace frames according to FPS
      const delay = Math.max(1, Math.round(1000 / currentFps));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    encoder.free();
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<EncodeWorkerInput>) => {
  const msg = event.data;

  switch (msg.type) {
    case "start":
      currentFps = msg.fps ?? getPresetConfig(msg.preset).targetFps;
      startEncoding(msg.file, msg.filename, msg.preset, msg.blockSize ?? 250);
      break;
    case "set_fps":
      currentFps = msg.fps;
      break;
    case "stop":
      running = false;
      break;
  }
};
