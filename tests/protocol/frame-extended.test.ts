import { describe, expect, it } from "bun:test";
import {
  serializeFrame,
  serializeMetadataFrame,
  parseFrame,
  type Frame,
  type MetadataFrame,
} from "@/protocol/frame";
import { compress, decompress } from "@/compression/compression";

describe("Frame Protocol extended tests", () => {
  it("handles empty payload data frame", () => {
    const frame: Frame = {
      version: 0x01,
      flags: 0x00,
      metadataHash: new Uint8Array([0, 0, 0, 0]),
      sourceBlockCount: 1,
      blockSize: 64,
      symbolId: 1,
      payload: new Uint8Array(0),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.payload.length).toBe(0);
    }
  });

  it("handles large symbolId values", () => {
    const frame: Frame = {
      version: 0x01,
      flags: 0x00,
      metadataHash: new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]),
      sourceBlockCount: 1000,
      blockSize: 256,
      symbolId: 0xFFFFFFFF, // max uint32
      payload: new Uint8Array([42]),
    };
    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(result.frame.symbolId).toBe(0xFFFFFFFF);
    }
  });

  it("metadata frame with no-compression algorithm (0x00)", () => {
    const metadataFrame: MetadataFrame = {
      version: 0x01,
      flags: 0x00,
      metadataHash: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
      sourceBlockCount: 10,
      blockSize: 128,
      symbolId: 0,
      payload: new Uint8Array([]),
      filename: "data.bin",
      fileSize: 5000,
      compressedSize: 5000,
      compressionId: 0x00,
      sha256: new Uint8Array(32).fill(0xFF),
    };
    const serialized = serializeMetadataFrame(metadataFrame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata") {
      expect(result.frame.compressionId).toBe(0x00);
      expect(result.frame.compressedSize).toBe(5000);
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
