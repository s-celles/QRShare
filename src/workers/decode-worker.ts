import { hashSha256 } from "@/crypto/hash";
import { decompress } from "@/compression/compression";
import type { CompressionAlgorithm } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import { parseFrame } from "@/protocol/frame";
import type { FountainDecoder } from "@/codec/types";
import { ZBarQRScanner } from "@/qr/scanner";
import type { DecodeWorkerInput, DecodeWorkerOutput } from "./types";

let running = false;
let scanner: ZBarQRScanner | null = null;
let decoder: FountainDecoder | null = null;

// State tracking
let metadataReceived = false;
let expectedFilename = "";
let expectedFileSize = 0;
let expectedSha256 = new Uint8Array(0);
let compressionAlgorithm: CompressionAlgorithm = 0x00;
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

async function processFrame(imageData: ImageData): Promise<void> {
  if (!running || !scanner) return;

  try {
    const scanResult = await scanner.scan(imageData);
    if (!scanResult) return;

    const parseResult = parseFrame(scanResult.data);

    if (parseResult.kind === "unknown_version") {
      return; // Ignore frames with unknown versions
    }

    if (parseResult.kind === "error") {
      return; // Ignore malformed frames
    }

    // Handle metadata frame
    if (parseResult.kind === "metadata") {
      if (!metadataReceived) {
        metadataReceived = true;
        expectedFilename = parseResult.frame.filename;
        expectedFileSize = parseResult.frame.fileSize;
        expectedSha256 = new Uint8Array(parseResult.frame.sha256);
        compressionAlgorithm = parseResult.frame.compressionId;
        expectedMetadataHash = new Uint8Array(parseResult.frame.metadataHash);
        metadataHashHex = toHex(expectedMetadataHash);

        // Initialize fountain decoder with compressed size
        const factory = await getCodecFactory();
        decoder = await factory.createDecoder();
        decoder.init(
          parseResult.frame.compressedSize,
          parseResult.frame.blockSize,
        );

        post({
          type: "metadata",
          filename: expectedFilename,
          fileSize: expectedFileSize,
        });
      }
      return;
    }

    // Handle data frame
    if (parseResult.kind === "data" && decoder && metadataReceived) {
      // Validate metadata hash matches
      if (!arraysEqual(parseResult.frame.metadataHash, expectedMetadataHash)) {
        return; // Hash mismatch, ignore this frame
      }

      const frameSymbolId = parseResult.frame.symbolId;
      // Convert frame symbolId back to encoder blockId (frame offsets by +1)
      const blockId = frameSymbolId - 1;

      // Deduplicate
      if (receivedSymbolIds.has(blockId)) {
        return;
      }
      receivedSymbolIds.add(blockId);

      const status = decoder.addSymbol(blockId, parseResult.frame.payload);

      if (status.kind === "need_more") {
        post({
          type: "progress",
          uniqueSymbols: status.received,
          neededSymbols: status.needed,
          metadataHash: metadataHashHex,
        });
      } else if (status.kind === "complete") {
        // Recover data
        const compressedData = decoder.recover();

        // Decompress
        const fileData = decompress(compressedData, compressionAlgorithm);

        // Verify SHA-256
        const actualHash = await hashSha256(fileData);
        const verified = arraysEqual(actualHash, expectedSha256);

        post({
          type: "complete",
          file: fileData.buffer as ArrayBuffer,
          filename: expectedFilename,
          sha256: toHex(actualHash),
          verified,
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
