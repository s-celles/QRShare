import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import {
  serializeFrame,
  serializeMetadataFrame,
  PROTOCOL_VERSION,
  type MetadataFrame,
  type Frame,
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

    // Step 1: Hash
    const sha256Full = await hashSha256(fileData);
    const metaHash = await truncatedHash(fileData, 4);

    // Step 2: Compress
    const compressed = compress(fileData);

    // Step 3: Init fountain encoder
    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();

    const maxPayload = getMaxPayloadBytes(preset);
    // Reserve header bytes (14) from max payload
    const blockSize = Math.max(1, maxPayload - 14);

    encoder.init(compressed.data, blockSize);
    const k = encoder.getSourceBlockCount();

    // Send metadata to main thread
    post({
      type: "metadata",
      totalBlocks: k,
      fileSize: fileData.length,
      sha256: toHex(sha256Full),
    });

    // Step 4: Serialize and send metadata frame (symbolId=0)
    const metadataFrame: MetadataFrame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: metaHash,
      sourceBlockCount: k,
      blockSize,
      symbolId: 0,
      payload: new Uint8Array(0),
      filename,
      fileSize: fileData.length,
      compressedSize: compressed.data.length,
      compressionId: compressed.algorithm,
      sha256: sha256Full,
    };

    const metaFrameBytes = serializeMetadataFrame(metadataFrame);
    if (running) {
      const buf = new ArrayBuffer(metaFrameBytes.byteLength);
      new Uint8Array(buf).set(metaFrameBytes);
      post({ type: "frame", frameBytes: buf, symbolId: 0, frameNumber: 0 });
    }

    // Step 5: Generate fountain-coded frames indefinitely
    // Re-send metadata frame every METADATA_INTERVAL data frames
    const METADATA_INTERVAL = 10;
    let frameNumber = 1;
    let symbolId = 0;

    while (running) {
      // Periodically re-send metadata so receiver can join at any point
      if (symbolId > 0 && symbolId % METADATA_INTERVAL === 0) {
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
