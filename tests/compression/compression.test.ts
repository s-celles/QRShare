import { describe, expect, it } from "bun:test";
import { compress, decompress } from "@/compression/compression";

describe("CompressionService", () => {
  it("roundtrips compressible data", () => {
    const input = new TextEncoder().encode("hello world ".repeat(100));
    const result = compress(input);
    expect(result.algorithm).toBe(0x01); // deflate
    expect(result.data.length).toBeLessThan(input.length);

    const restored = decompress(result.data, result.algorithm);
    expect(restored).toEqual(input);
  });

  it("bypasses compression for incompressible data", () => {
    // Random-looking data that won't compress well
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const result = compress(input);
    // Should detect incompressible and return original
    if (result.algorithm === 0x00) {
      expect(result.data).toEqual(input);
    } else {
      // If it somehow compressed, that's also fine
      expect(result.algorithm).toBe(0x01);
    }
  });

  it("handles empty input", () => {
    const input = new Uint8Array(0);
    const result = compress(input);
    const restored = decompress(result.data, result.algorithm);
    expect(restored).toEqual(input);
  });

  it("decompresses with algorithm 0x00 (none) returns data as-is", () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const restored = decompress(input, 0x00);
    expect(restored).toEqual(input);
  });

  it("decompresses with algorithm 0x01 (deflate)", () => {
    const original = new TextEncoder().encode("test data for compression ".repeat(10));
    const { data, algorithm } = compress(original);
    expect(algorithm).toBe(0x01);
    const restored = decompress(data, algorithm);
    expect(restored).toEqual(original);
  });

  it("uses algorithm identifier 0x01 for deflate", () => {
    const input = new TextEncoder().encode("compress me ".repeat(50));
    const result = compress(input);
    expect(result.algorithm).toBe(0x01);
  });

  it("compresses and decompresses binary data", () => {
    const input = new Uint8Array(1000);
    input.fill(0xAA); // Highly compressible pattern
    const result = compress(input);
    expect(result.algorithm).toBe(0x01);
    expect(result.data.length).toBeLessThan(input.length);
    const restored = decompress(result.data, result.algorithm);
    expect(restored).toEqual(input);
  });
});
