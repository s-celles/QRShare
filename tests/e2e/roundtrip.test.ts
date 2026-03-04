import { describe, expect, it } from "bun:test";
import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress, decompress } from "@/compression/compression";
import { serializeFrame, parseFrame, getFrameOverhead, PROTOCOL_VERSION, type Frame } from "@/protocol/frame";
import { LTFountainEncoder, LTFountainDecoder } from "@/codec/lt-adapter";
import { getMaxPayloadBytes } from "@/qr/renderer";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("E2E roundtrip pipeline", () => {
  it("encodes and decodes a small text file", async () => {
    // === SENDER PIPELINE ===
    const originalText = "Hello, QRShare! This is a test file for end-to-end roundtrip testing. ".repeat(5);
    const originalData = new TextEncoder().encode(originalText);
    const filename = "test.txt";

    // 1. Hash
    const sha256 = await hashSha256(originalData);
    const metaHash = await truncatedHash(originalData, 4);

    // 2. Compress
    const compressed = compress(originalData);

    // 3. Fountain encode
    const preset = "balanced" as const;
    const maxPayload = getMaxPayloadBytes(preset);
    const filenameBytes = new TextEncoder().encode(filename);
    const overhead = getFrameOverhead(filenameBytes.length);
    const blockSize = maxPayload - overhead;

    const encoder = new LTFountainEncoder();
    encoder.init(compressed.data, blockSize);
    const K = encoder.getSourceBlockCount();

    // 4. Generate data frames (every frame embeds metadata, v3 protocol)
    const allFrameBytes: Uint8Array[] = [];
    for (let id = 0; id < K * 3; id++) {
      const symbol = encoder.encode(id);
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: K,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: id + 1,
        filename,
        fileSize: originalData.length,
        sha256,
        payload: symbol,
      };
      allFrameBytes.push(serializeFrame(frame));
    }

    // 5. Verify each frame fits within QR max payload
    for (const frameBytes of allFrameBytes) {
      expect(frameBytes.length).toBeLessThanOrEqual(maxPayload);
    }

    // === RECEIVER PIPELINE ===
    let recvFilename = "";
    let recvFileSize = 0;
    let recvSha256 = new Uint8Array(0);

    const decoder = new LTFountainDecoder();
    let decoderInitialized = false;
    let decodedData: Uint8Array | null = null;
    let recvCompressionId: 0x00 | 0x01 = 0x00;

    for (const frameBytes of allFrameBytes) {
      const parsed = parseFrame(frameBytes);

      if (parsed.kind !== "data") continue;

      // Extract metadata from first frame (v3: every frame has it)
      if (!decoderInitialized) {
        const frame = parsed.frame;
        decoder.init(frame.compressedSize, frame.blockSize);
        recvCompressionId = frame.compressionId;
        recvFilename = frame.filename;
        recvFileSize = frame.fileSize;
        recvSha256 = new Uint8Array(frame.sha256);
        decoderInitialized = true;
      }

      const blockId = parsed.frame.symbolId - 1; // convert back
      const status = decoder.addSymbol(blockId, parsed.frame.payload);
      if (status.kind === "complete") {
        decodedData = decoder.recover();
        break;
      }
    }

    expect(decodedData).not.toBeNull();
    expect(recvFilename).toBe("test.txt");
    expect(recvFileSize).toBe(originalData.length);

    // 6. Decompress
    const decompressed = decompress(decodedData!, recvCompressionId);

    // 7. Verify SHA-256
    const recvHash = await hashSha256(decompressed);
    expect(toHex(recvHash)).toBe(toHex(recvSha256));

    // 8. Verify byte-identical
    expect(decompressed).toEqual(originalData);

    encoder.free();
    decoder.free();
  });

  it("encodes and decodes binary data", async () => {
    // Binary data with all byte values
    const originalData = new Uint8Array(2048);
    for (let i = 0; i < originalData.length; i++) originalData[i] = i % 256;
    const filename = "binary.bin";

    const sha256 = await hashSha256(originalData);
    const metaHash = await truncatedHash(originalData, 4);
    const compressed = compress(originalData);

    const blockSize = 200;
    const encoder = new LTFountainEncoder();
    encoder.init(compressed.data, blockSize);
    const K = encoder.getSourceBlockCount();

    const decoder = new LTFountainDecoder();

    // Feed frames — every frame has metadata (v3)
    let decodedData: Uint8Array | null = null;
    let decoderInitialized = false;
    for (let id = 0; id < K * 5; id++) {
      const symbol = encoder.encode(id);
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: K,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: id + 1,
        filename,
        fileSize: originalData.length,
        sha256,
        payload: symbol,
      };
      const serialized = serializeFrame(frame);
      const parsed = parseFrame(serialized);
      if (parsed.kind === "data") {
        if (!decoderInitialized) {
          decoder.init(parsed.frame.compressedSize, parsed.frame.blockSize);
          decoderInitialized = true;
        }
        const blockId = parsed.frame.symbolId - 1;
        const status = decoder.addSymbol(blockId, parsed.frame.payload);
        if (status.kind === "complete") {
          decodedData = decoder.recover();
          break;
        }
      }
    }

    expect(decodedData).not.toBeNull();
    const decompressed = decompress(decodedData!, compressed.algorithm);
    expect(decompressed).toEqual(originalData);

    encoder.free();
    decoder.free();
  });
});
