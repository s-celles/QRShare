import { describe, expect, it } from "bun:test";
import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress, decompress } from "@/compression/compression";
import { serializeFrame, serializeMetadataFrame, parseFrame, type Frame, type MetadataFrame } from "@/protocol/frame";
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
    const blockSize = maxPayload - 14; // subtract header size

    const encoder = new LTFountainEncoder();
    encoder.init(compressed.data, blockSize);
    const K = encoder.getSourceBlockCount();

    // 4. Create metadata frame
    const metaFrame: MetadataFrame = {
      version: 0x01,
      flags: 0x00,
      metadataHash: metaHash,
      sourceBlockCount: K,
      blockSize,
      symbolId: 0,
      payload: new Uint8Array([]),
      filename,
      fileSize: originalData.length,
      compressedSize: compressed.data.length,
      compressionId: compressed.algorithm,
      sha256,
    };
    const metadataBytes = serializeMetadataFrame(metaFrame);

    // 5. Generate data frames (symbolId starts at 1)
    const allFrameBytes: Uint8Array[] = [metadataBytes];
    for (let id = 0; id < K * 3; id++) {
      const symbol = encoder.encode(id);
      const frame: Frame = {
        version: 0x01,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: K,
        blockSize,
        symbolId: id + 1,
        payload: symbol,
      };
      allFrameBytes.push(serializeFrame(frame));
    }

    // 6. Verify each frame fits within QR max payload
    for (const frameBytes of allFrameBytes) {
      expect(frameBytes.length).toBeLessThanOrEqual(maxPayload);
    }

    // === RECEIVER PIPELINE ===
    // Simulate receiving frames by parsing them back (QR scan would produce the same bytes)

    let recvFilename = "";
    let recvFileSize = 0;
    let recvCompressedSize = 0;
    let recvCompressionId: 0x00 | 0x01 = 0x00;
    let recvSha256 = new Uint8Array(0);
    let recvBlockSize = 0;

    const decoder = new LTFountainDecoder();
    let decoderInitialized = false;
    let decodedData: Uint8Array | null = null;

    // Compute seed for LT decoder (same as encoder uses internally)
    let seed = 0x811c9dc5;
    for (let i = 0; i < Math.min(compressed.data.length, 1024); i++) {
      seed ^= compressed.data[i];
      seed = Math.imul(seed, 0x01000193);
    }
    seed = seed >>> 0;

    for (const frameBytes of allFrameBytes) {
      const parsed = parseFrame(frameBytes);
      if (parsed.kind === "metadata") {
        recvFilename = parsed.frame.filename;
        recvFileSize = parsed.frame.fileSize;
        recvCompressedSize = parsed.frame.compressedSize;
        recvCompressionId = parsed.frame.compressionId;
        recvSha256 = new Uint8Array(parsed.frame.sha256);
        recvBlockSize = parsed.frame.blockSize;

        // Initialize decoder with compressed size
        decoder.init(recvCompressedSize, recvBlockSize);
        decoder.setBaseSeed(seed);
        decoderInitialized = true;
        continue;
      }

      if (parsed.kind === "data" && decoderInitialized) {
        const blockId = parsed.frame.symbolId - 1; // convert back
        const status = decoder.addSymbol(blockId, parsed.frame.payload);
        if (status.kind === "complete") {
          decodedData = decoder.recover();
          break;
        }
      }
    }

    expect(decodedData).not.toBeNull();
    expect(recvFilename).toBe("test.txt");
    expect(recvFileSize).toBe(originalData.length);

    // 7. Decompress
    const decompressed = decompress(decodedData!, recvCompressionId);

    // 8. Verify SHA-256
    const recvHash = await hashSha256(decompressed);
    expect(toHex(recvHash)).toBe(toHex(recvSha256));

    // 9. Verify byte-identical
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

    const metaFrame: MetadataFrame = {
      version: 0x01,
      flags: 0x00,
      metadataHash: metaHash,
      sourceBlockCount: K,
      blockSize,
      symbolId: 0,
      payload: new Uint8Array([]),
      filename,
      fileSize: originalData.length,
      compressedSize: compressed.data.length,
      compressionId: compressed.algorithm,
      sha256,
    };

    const metadataBytes = serializeMetadataFrame(metaFrame);

    // Compute seed for decoder
    let seed = 0x811c9dc5;
    for (let i = 0; i < Math.min(compressed.data.length, 1024); i++) {
      seed ^= compressed.data[i];
      seed = Math.imul(seed, 0x01000193);
    }
    seed = seed >>> 0;

    const decoder = new LTFountainDecoder();

    // Parse metadata
    const metaParsed = parseFrame(metadataBytes);
    expect(metaParsed.kind).toBe("metadata");
    if (metaParsed.kind === "metadata") {
      decoder.init(metaParsed.frame.compressedSize, metaParsed.frame.blockSize);
      decoder.setBaseSeed(seed);
    }

    // Feed symbols
    let decodedData: Uint8Array | null = null;
    for (let id = 0; id < K * 5; id++) {
      const symbol = encoder.encode(id);
      const frame: Frame = {
        version: 0x01,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: K,
        blockSize,
        symbolId: id + 1,
        payload: symbol,
      };
      const serialized = serializeFrame(frame);
      const parsed = parseFrame(serialized);
      if (parsed.kind === "data") {
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
