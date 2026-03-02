import { describe, expect, it } from "bun:test";
import { getCodecFactory } from "@/codec/factory";

describe("Codec Factory", () => {
  it("returns a factory", async () => {
    const factory = await getCodecFactory();
    expect(factory).toBeDefined();
    expect(typeof factory.createEncoder).toBe("function");
    expect(typeof factory.createDecoder).toBe("function");
    expect(typeof factory.isWasmAvailable).toBe("function");
  });

  it("factory can create encoder and decoder", async () => {
    const factory = await getCodecFactory();
    const encoder = await factory.createEncoder();
    const decoder = await factory.createDecoder();
    expect(encoder).toBeDefined();
    expect(decoder).toBeDefined();
    encoder.free();
    decoder.free();
  });

  it("selected factory produces working roundtrip", async () => {
    const factory = await getCodecFactory();
    const original = new Uint8Array(500);
    for (let i = 0; i < 500; i++) original[i] = i % 256;
    const blockSize = 64;

    const encoder = await factory.createEncoder();
    encoder.init(original, blockSize);
    const k = encoder.getSourceBlockCount();

    const decoder = await factory.createDecoder();
    decoder.init(original.length, blockSize);

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
});
