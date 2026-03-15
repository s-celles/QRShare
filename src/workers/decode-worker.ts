import { hashSha256 } from "@/crypto/hash";
import { decompress } from "@/compression/compression";
import type { CompressionAlgorithm } from "@/compression/compression";
import { LTCodecFactory } from "@/codec/lt-adapter";
import { parseFrame, decodeFlags } from "@/protocol/frame";
import type { FountainDecoder } from "@/codec/types";
import { ZBarQRScanner } from "@/qr/scanner";
import type { DecodeWorkerInput, DecodeWorkerOutput } from "./types";

let running = false;
let processing = false;
let scanner: ZBarQRScanner | null = null;
let decoder: FountainDecoder | null = null;

// State tracking
let decoderReady = false;
let metadataSent = false;
let expectedFilename = "";
let expectedFileSize = 0;
let expectedSha256 = new Uint8Array(0);
let compressionAlgorithm: CompressionAlgorithm = 0x00;
let contentIsText = false;
let metadataHashHex = "";
let expectedMetadataHash = new Uint8Array(0);
const receivedSymbolIds = new Set<number>();

function post(msg: DecodeWorkerOutput): void {
  self.postMessage(msg);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function initDecoder(
  compressedSize: number,
  blockSize: number,
  compId: CompressionAlgorithm,
  metadataHash: Uint8Array,
): Promise<void> {
  compressionAlgorithm = compId;
  expectedMetadataHash = new Uint8Array(metadataHash);
  metadataHashHex = toHex(expectedMetadataHash);

  // Always use LT codec for QR transfers to ensure cross-device compatibility.
  const factory = new LTCodecFactory();
  decoder = await factory.createDecoder();
  decoder.init(compressedSize, blockSize);
  decoderReady = true;
}

async function processFrame(imageData: ImageData): Promise<void> {
  if (!running || !scanner || processing) return;
  processing = true;

  try {
    const scanResult = await scanner.scan(imageData);
    if (!scanResult) return;

    const parseResult = parseFrame(scanResult.data);

    if (parseResult.kind === "unknown_version" || parseResult.kind === "error") {
      return;
    }

    const frame = parseResult.frame;

    // Initialize decoder from ANY frame (v3: every frame has full metadata)
    if (!decoderReady) {
      await initDecoder(
        frame.compressedSize,
        frame.blockSize,
        frame.compressionId,
        frame.metadataHash,
      );
    }

    // Extract metadata from every frame (v3: embedded in all frames)
    if (!metadataSent) {
      metadataSent = true;
      expectedFilename = frame.filename;
      expectedFileSize = frame.fileSize;
      expectedSha256 = new Uint8Array(frame.sha256);
      contentIsText = decodeFlags(frame.flags).isText;

      post({
        type: "metadata",
        filename: expectedFilename,
        fileSize: expectedFileSize,
      });
    }

    // Handle data frame
    if (decoderReady && decoder) {
      // Validate metadata hash matches
      if (!arraysEqual(frame.metadataHash, expectedMetadataHash)) {
        return;
      }

      const frameSymbolId = frame.symbolId;
      const blockId = frameSymbolId - 1;

      // Deduplicate
      if (receivedSymbolIds.has(blockId)) {
        return;
      }
      receivedSymbolIds.add(blockId);

      const status = decoder.addSymbol(blockId, frame.payload);

      if (status.kind === "need_more") {
        post({
          type: "progress",
          uniqueSymbols: status.received,
          neededSymbols: status.needed,
          scannedFrames: receivedSymbolIds.size,
          metadataHash: metadataHashHex,
        });
      } else if (status.kind === "complete") {
        const compressedData = decoder.recover();
        const fileData = decompress(compressedData, compressionAlgorithm);

        const actualHash = await hashSha256(fileData);
        const verified = arraysEqual(actualHash, expectedSha256);

        post({
          type: "complete",
          file: fileData.buffer as ArrayBuffer,
          filename: expectedFilename || "download",
          sha256: toHex(actualHash),
          verified,
          isText: contentIsText,
        });

        running = false;
        decoder.free();
        decoder = null;
      }
    }
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    processing = false;
  }
}

async function initScanner(): Promise<void> {
  scanner = new ZBarQRScanner();
  await scanner.init();
}

self.onmessage = async (event: MessageEvent<DecodeWorkerInput>) => {
  const msg = event.data;

  switch (msg.type) {
    case "frame":
      if (!scanner) {
        try {
          await initScanner();
          running = true;
        } catch (err) {
          post({ type: "error", message: `Scanner init failed: ${err instanceof Error ? err.message : String(err)}` });
          return;
        }
      }
      processFrame(msg.imageData);
      break;
    case "stop":
      running = false;
      if (scanner) {
        scanner.destroy();
        scanner = null;
      }
      if (decoder) {
        decoder.free();
        decoder = null;
      }
      break;
  }
};
