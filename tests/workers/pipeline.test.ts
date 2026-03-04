import { describe, expect, it } from "bun:test";
import { hashSha256, truncatedHash } from "@/crypto/hash";
import { compress, decompress } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import {
  serializeFrame,
  parseFrame,
  getFrameOverhead,
  PROTOCOL_VERSION,
  type Frame,
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

    // Data frames (v3: every frame has metadata)
    for (let i = 0; i < 3; i++) {
      const symbolData = encoder.encode(i);
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: i + 1,
        filename,
        fileSize: fileData.length,
        sha256,
        payload: symbolData,
      };
      const frameBytes = serializeFrame(frame);
      const filenameLen = new TextEncoder().encode(filename).length;
      const expectedSize = getFrameOverhead(filenameLen) + symbolData.length;
      expect(frameBytes.length).toBe(expectedSize);

      // Render QR
      const bitmap = renderQR(frameBytes, "balanced");
      expect(bitmap.size).toBeGreaterThan(0);
    }

    encoder.free();
  });

  it("full receiver pipeline: parse frame → fountain decode → decompress → verify", async () => {
    const original = new Uint8Array(800);
    for (let i = 0; i < 800; i++) original[i] = (i * 7 + 3) % 256;
    const filename = "test.bin";

    // Sender side
    const sha256 = await hashSha256(original);
    const metaHash = await truncatedHash(original, 4);
    const compressed = compress(original);

    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();
    const blockSize = 128;
    encoder.init(compressed.data, blockSize);
    const k = encoder.getSourceBlockCount();

    // Initialize decoder from first frame (v3: every frame has metadata)
    const decoder = await factory.createDecoder();
    let decoderInitialized = false;

    // Send fountain symbols until decode completes
    let status;
    for (let blockId = 0; blockId < k + 10; blockId++) {
      const symbolData = encoder.encode(blockId);
      const frameSymbolId = blockId + 1;
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: metaHash,
        sourceBlockCount: k,
        blockSize,
        compressedSize: compressed.data.length,
        compressionId: compressed.algorithm,
        symbolId: frameSymbolId,
        filename,
        fileSize: original.length,
        sha256,
        payload: symbolData,
      };

      // Serialize then parse (simulating QR encode/decode)
      const frameBytes = serializeFrame(frame);
      const parseResult = parseFrame(frameBytes);
      expect(parseResult.kind).toBe("data");
      if (parseResult.kind !== "data") continue;

      // Initialize decoder from first frame
      if (!decoderInitialized) {
        decoder.init(parseResult.frame.compressedSize, parseResult.frame.blockSize);
        expect(parseResult.frame.filename).toBe("test.bin");
        expect(parseResult.frame.fileSize).toBe(original.length);
        decoderInitialized = true;
      }

      status = decoder.addSymbol(blockId, parseResult.frame.payload);
      if (status.kind === "complete") break;
    }

    expect(status!.kind).toBe("complete");

    // Recover and decompress
    const recoveredCompressed = decoder.recover();
    const recovered = decompress(
      recoveredCompressed,
      compressed.algorithm,
    );

    // Verify SHA-256
    const recoveredHash = await hashSha256(recovered);
    expect(recovered).toEqual(original);
    expect(recoveredHash).toEqual(sha256);

    encoder.free();
    decoder.free();
  });
});
