import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import {
  serializeFrame,
  serializeMetadataFrame,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  type Frame,
  type MetadataFrame,
} from "@/protocol/frame";
import { getMaxPayloadBytes, getPresetConfig } from "@/qr/renderer";
import type { EncodingPreset } from "@/qr/renderer";
import type { EncodeWorkerInput, EncodeWorkerOutput } from "./types";

let running = false;
let currentFps = 12;

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

    // Step 3: Init fountain encoder
    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();

    const maxPayload = getMaxPayloadBytes(preset);
    // Reserve header bytes from max payload
    const blockSize = Math.max(1, maxPayload - HEADER_SIZE);

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

    // Step 4: Build a metadata frame padded to blockSize so it generates
    // the same QR version/density as data frames (no visual flicker).
    const metadataFrame: MetadataFrame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: metaHash,
      sourceBlockCount: k,
      blockSize,
      compressedSize: compressed.data.length,
      compressionId: compressed.algorithm,
      symbolId: 0,
      payload: new Uint8Array(0),
      filename,
      fileSize: fileData.length,
      sha256: sha256Full,
    };
    const metaFrameBytes = serializeMetadataFrame(metadataFrame, blockSize);

    // Step 5: Generate frames indefinitely.
    // Every frame header contains compressedSize + compressionId,
    // so the decoder initializes from ANY frame (like CAScad).
    // Metadata frames (padded to same size) are interleaved periodically
    // so the receiver learns filename, fileSize, and sha256.
    const METADATA_INTERVAL = 30;
    let frameNumber = 0;
    let symbolId = 0;

    while (running) {
      // Periodically send a padded metadata frame for filename/sha256
      if (symbolId % METADATA_INTERVAL === 0) {
        const buf = new ArrayBuffer(metaFrameBytes.byteLength);
        new Uint8Array(buf).set(metaFrameBytes);
        post({ type: "frame", frameBytes: buf, symbolId: 0, frameNumber });
        frameNumber++;

        const delay = Math.max(1, Math.round(1000 / currentFps));
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (!running) break;
      }

      const symbolData = encoder.encode(symbolId);

      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: symbolId + 1, // symbolId 0 is reserved for metadata
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
      currentFps = getPresetConfig(msg.preset).targetFps;
      startEncoding(msg.file, msg.filename, msg.preset);
      break;
    case "set_fps":
      currentFps = msg.fps;
      break;
    case "stop":
      running = false;
      break;
  }
};
