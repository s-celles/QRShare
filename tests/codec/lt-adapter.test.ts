import { describe, expect, it } from "bun:test";
import { LTFountainEncoder, LTFountainDecoder } from "@/codec/lt-adapter";

describe("LT Fountain Codec", () => {
  function createTestData(size: number): Uint8Array {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = i % 256;
    return data;
  }

  it("roundtrips a small payload", () => {
    const original = createTestData(500);
    const blockSize = 64;

    const encoder = new LTFountainEncoder();
    encoder.init(original, blockSize);
    const k = encoder.getSourceBlockCount();
    expect(k).toBe(Math.ceil(500 / 64));

    const decoder = new LTFountainDecoder();
    decoder.init(original.length, blockSize);
    // The decoder needs the same seed as encoder. Use setBaseSeed.
    // Compute the same seed the encoder uses internally.
    let seed = 0x811c9dc5;
    for (let i = 0; i < Math.min(original.length, 1024); i++) {
      seed ^= original[i];
      seed = Math.imul(seed, 0x01000193);
    }
    seed = seed >>> 0;
    decoder.setBaseSeed(seed);

    // Send many more symbols than k to ensure decode
    let status;
    for (let id = 0; id < k * 5; id++) {
      const symbol = encoder.encode(id);
      status = decoder.addSymbol(id, symbol);
      if (status.kind === "complete") break;
    }

    expect(status!.kind).toBe("complete");
    const recovered = decoder.recover();
    expect(recovered).toEqual(original);

    encoder.free();
    decoder.free();
  });

  it("produces deterministic symbols", () => {
    const data = createTestData(256);
    const blockSize = 32;

    const encoder = new LTFountainEncoder();
    encoder.init(data, blockSize);

    const sym1 = encoder.encode(5);
    const sym2 = encoder.encode(5);
    expect(sym1).toEqual(sym2);

    encoder.free();
  });

  it("decodes from random subset of symbols", () => {
    const original = createTestData(1024);
    const blockSize = 128;

    const encoder = new LTFountainEncoder();
    encoder.init(original, blockSize);
    const k = encoder.getSourceBlockCount();

    const decoder = new LTFountainDecoder();
    decoder.init(original.length, blockSize);
    let seed = 0x811c9dc5;
    for (let i = 0; i < Math.min(original.length, 1024); i++) {
      seed ^= original[i];
      seed = Math.imul(seed, 0x01000193);
    }
    decoder.setBaseSeed(seed >>> 0);

    // Generate symbols with non-sequential IDs (simulate random loss)
    const ids: number[] = [];
    for (let i = 0; i < k * 10; i++) {
      if (Math.random() > 0.3 || ids.length < k) ids.push(i);
    }

    let status;
    for (const id of ids) {
      const symbol = encoder.encode(id);
      status = decoder.addSymbol(id, symbol);
      if (status.kind === "complete") break;
    }

    expect(status!.kind).toBe("complete");
    const recovered = decoder.recover();
    expect(recovered).toEqual(original);

    encoder.free();
    decoder.free();
  });

  it("getSourceBlockCount returns correct value", () => {
    const encoder = new LTFountainEncoder();
    encoder.init(createTestData(1000), 100);
    expect(encoder.getSourceBlockCount()).toBe(10);

    encoder.init(createTestData(1001), 100);
    expect(encoder.getSourceBlockCount()).toBe(11);

    encoder.free();
  });
});
