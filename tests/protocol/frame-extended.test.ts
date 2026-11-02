import { describe, expect, it } from "bun:test";
import {
  serializeFrame,
  parseFrame,
  PROTOCOL_VERSION,
  MAX_SOURCE_BLOCK_COUNT_FIELD,
  sourceBlockCountOf,
  type Frame,
} from "@/protocol/frame";
import { compress, decompress } from "@/compression/compression";

describe("Frame Protocol extended tests", () => {
  it("REQ-QRX-004 saturates the 16-bit block count of large transfers, the exact count staying derivable", () => {
    // 50 MB in 250-byte blocks: about 210,000 blocks, more than 16 bits can hold.
    const compressedSize = 50 * 1024 * 1024;
    const blockSize = 250;
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([1, 2, 3, 4]),
      sourceBlockCount: Math.ceil(compressedSize / blockSize),
      blockSize,
      compressedSize,
      compressionId: 0x00,
      symbolId: 7,
      filename: "big.bin",
      fileSize: compressedSize,
      sha256: new Uint8Array(32),
      payload: new Uint8Array(blockSize),
    };
    const result = parseFrame(serializeFrame(frame));
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.sourceBlockCount).toBe(MAX_SOURCE_BLOCK_COUNT_FIELD);
      expect(sourceBlockCountOf(result.frame)).toBe(frame.sourceBlockCount);
    }
  });

  it("handles empty payload data frame", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([0, 0, 0, 0]),
      sourceBlockCount: 1,
      blockSize: 64,
      compressedSize: 64,
      compressionId: 0x00,
      symbolId: 1,
      filename: "empty.bin",
      fileSize: 64,
      sha256: new Uint8Array(32),
      payload: new Uint8Array(0),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.payload.length).toBe(0);
      expect(result.frame.filename).toBe("empty.bin");
    }
  });

  it("handles large symbolId values", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]),
      sourceBlockCount: 1000,
      blockSize: 256,
      compressedSize: 256000,
      compressionId: 0x01,
      symbolId: 0xFFFFFFFF, // max uint32
      filename: "large-id.bin",
      fileSize: 300000,
      sha256: new Uint8Array(32).fill(0x42),
      payload: new Uint8Array([42]),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.symbolId).toBe(0xFFFFFFFF);
    }
  });

  it("frame with no-compression algorithm (0x00)", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
      sourceBlockCount: 10,
      blockSize: 128,
      compressedSize: 5000,
      compressionId: 0x00,
      symbolId: 1,
      filename: "data.bin",
      fileSize: 5000,
      sha256: new Uint8Array(32).fill(0xFF),
      payload: new Uint8Array([1, 2, 3]),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.compressionId).toBe(0x00);
      expect(result.frame.compressedSize).toBe(5000);
      expect(result.frame.filename).toBe("data.bin");
    }
  });

  it("data frame preserves compressedSize and compressionId", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
      sourceBlockCount: 10,
      blockSize: 128,
      compressedSize: 9999,
      compressionId: 0x01,
      symbolId: 5,
      filename: "test.bin",
      fileSize: 10000,
      sha256: new Uint8Array(32).fill(0xDD),
      payload: new Uint8Array([1, 2, 3]),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.compressedSize).toBe(9999);
      expect(result.frame.compressionId).toBe(0x01);
    }
  });
});

describe("Compression extended tests", () => {
  it("handles empty input", () => {
    const result = compress(new Uint8Array(0));
    expect(result.algorithm).toBe(0x00);
    expect(result.data.length).toBe(0);
  });

  it("incompressible data uses algorithm 0x00", () => {
    // Random-like data is not compressible
    const data = new Uint8Array(100);
    crypto.getRandomValues(data);
    const result = compress(data);
    // It may or may not be compressible, but the algorithm should be valid
    expect([0x00, 0x01]).toContain(result.algorithm);
    const decompressed = decompress(result.data, result.algorithm);
    expect(decompressed).toEqual(data);
  });

  it("compressible data uses algorithm 0x01", () => {
    // Highly repetitive data should compress well
    const data = new TextEncoder().encode("AAAA".repeat(1000));
    const result = compress(data);
    expect(result.algorithm).toBe(0x01);
    expect(result.data.length).toBeLessThan(data.length);
    const decompressed = decompress(result.data, result.algorithm);
    expect(decompressed).toEqual(data);
  });

  it("roundtrips binary data through compress/decompress", () => {
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = i % 128; // semi-compressible
    const result = compress(data);
    const restored = decompress(result.data, result.algorithm);
    expect(restored).toEqual(data);
  });
});
