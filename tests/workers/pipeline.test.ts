import { describe, expect, it } from "bun:test";
import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress, decompress } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import {
  serializeFrame,
  serializeMetadataFrame,
  parseFrame,
  PROTOCOL_VERSION,
  type Frame,
  type MetadataFrame,
} from "@/protocol/frame";
import { renderQR } from "@/qr/renderer";

describe("Encode/Decode Pipeline", () => {
  it("full sender pipeline: hash → compress → fountain → frame → QR", async () => {
    const fileData = new Uint8Array(500);
    for (let i = 0; i < 500; i++) fileData[i] = i % 256;
    const filename = "test.bin";

    // Hash
    const sha256 = await hashSha256(fileData);
    expect(sha256.length).toBe(32);

    const metaHash = await truncatedHash(fileData, 4);
    expect(metaHash.length).toBe(4);

    // Compress
    const compressed = compress(fileData);

    // Fountain encode
    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();
    const blockSize = 100;
    encoder.init(compressed.data, blockSize);
    const k = encoder.getSourceBlockCount();
    expect(k).toBeGreaterThan(0);

    // Metadata frame
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
      sha256,
    };
    const metaBytes = serializeMetadataFrame(metadataFrame);
    expect(metaBytes.length).toBeGreaterThan(14);

    // Data frames
    for (let i = 0; i < 3; i++) {
      const symbolData = encoder.encode(i);
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        symbolId: i + 1,
        payload: symbolData,
      };
      const frameBytes = serializeFrame(frame);
      expect(frameBytes.length).toBe(14 + symbolData.length);

      // Render QR
      const bitmap = renderQR(frameBytes, "balanced");
      expect(bitmap.size).toBeGreaterThan(0);
    }

    encoder.free();
  });

  it("full receiver pipeline: parse frame → fountain decode → decompress → verify", async () => {
    const original = new Uint8Array(800);
    for (let i = 0; i < 800; i++) original[i] = (i * 7 + 3) % 256;

    // Sender side
    const sha256 = await hashSha256(original);
    const metaHash = await truncatedHash(original, 4);
    const compressed = compress(original);

    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();
    const blockSize = 128;
    encoder.init(compressed.data, blockSize);
    const k = encoder.getSourceBlockCount();

    // Serialize metadata frame
    const metadataFrame: MetadataFrame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: metaHash,
      sourceBlockCount: k,
      blockSize,
      symbolId: 0,
      payload: new Uint8Array(0),
      filename: "test.bin",
      fileSize: original.length,
      compressedSize: compressed.data.length,
      compressionId: compressed.algorithm,
      sha256,
    };
    const metaFrameBytes = serializeMetadataFrame(metadataFrame);

    // Receiver side: parse metadata frame
    const metaResult = parseFrame(metaFrameBytes);
    expect(metaResult.kind).toBe("metadata");
    if (metaResult.kind !== "metadata") throw new Error("Expected metadata");

    expect(metaResult.frame.filename).toBe("test.bin");
    expect(metaResult.frame.fileSize).toBe(original.length);

    // Initialize decoder
    const decoder = await factory.createDecoder();
    decoder.init(compressed.data.length, blockSize);

    // Send fountain symbols until decode completes
    // Use symbolId starting from 1 (0 is reserved for metadata frame)
    let status;
    for (let blockId = 0; blockId < k + 10; blockId++) {
      const symbolData = encoder.encode(blockId);
      const frameSymbolId = blockId + 1; // offset for frame protocol
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        symbolId: frameSymbolId,
        payload: symbolData,
      };

      // Serialize then parse (simulating QR encode/decode)
      const frameBytes = serializeFrame(frame);
      const parseResult = parseFrame(frameBytes);
      expect(parseResult.kind).toBe("data");
      if (parseResult.kind !== "data") continue;

      // Decoder must use the same blockId the encoder used
      status = decoder.addSymbol(blockId, parseResult.frame.payload);
      if (status.kind === "complete") break;
    }

    expect(status!.kind).toBe("complete");

    // Recover and decompress
    const recoveredCompressed = decoder.recover();
    const recovered = decompress(
      recoveredCompressed,
      metaResult.frame.compressionId,
    );

    // Verify SHA-256
    const recoveredHash = await hashSha256(recovered);
    expect(recovered).toEqual(original);
    expect(recoveredHash).toEqual(sha256);

    encoder.free();
    decoder.free();
  });
});
