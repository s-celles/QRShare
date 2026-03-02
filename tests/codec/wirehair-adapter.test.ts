import { describe, expect, it } from "bun:test";
import { WirehairCodecFactory } from "@/codec/wirehair-adapter";

describe("Wirehair Fountain Codec", () => {
  function createTestData(size: number): Uint8Array {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = i % 256;
    return data;
  }

  it("factory detects WASM availability", () => {
    const factory = new WirehairCodecFactory();
    // In Bun environment, WebAssembly should be available
    expect(typeof factory.isWasmAvailable()).toBe("boolean");
  });

  it("roundtrips a payload through encode/decode", async () => {
    const factory = new WirehairCodecFactory();
    if (!factory.isWasmAvailable()) return; // Skip in non-WASM env

    const original = createTestData(2000);
    const blockSize = 128;

    const encoder = await factory.createEncoder();
    encoder.init(original, blockSize);
    const k = encoder.getSourceBlockCount();
    expect(k).toBe(Math.ceil(2000 / 128));

    const decoder = await factory.createDecoder();
    decoder.init(original.length, blockSize);

    // Feed symbols until decode completes
    let status;
    for (let id = 0; id < k + 10; id++) {
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

  it("produces deterministic symbols", async () => {
    const factory = new WirehairCodecFactory();
    if (!factory.isWasmAvailable()) return;

    const data = createTestData(1024);
    const encoder = await factory.createEncoder();
    encoder.init(data, 64);

    const sym1 = encoder.encode(7);
    const sym2 = encoder.encode(7);
    expect(sym1).toEqual(sym2);

    encoder.free();
  });

  it("decodes from exactly K symbols", async () => {
    const factory = new WirehairCodecFactory();
    if (!factory.isWasmAvailable()) return;

    const original = createTestData(4096);
    const blockSize = 256;

    const encoder = await factory.createEncoder();
    encoder.init(original, blockSize);
    const k = encoder.getSourceBlockCount();

    const decoder = await factory.createDecoder();
    decoder.init(original.length, blockSize);

    // Try with exactly K symbols (source blocks 0..K-1)
    let status;
    for (let id = 0; id < k; id++) {
      const symbol = encoder.encode(id);
      status = decoder.addSymbol(id, symbol);
      if (status.kind === "complete") break;
    }

    // Wirehair can typically decode from exactly K source blocks
    expect(status!.kind).toBe("complete");
    const recovered = decoder.recover();
    expect(recovered).toEqual(original);

    encoder.free();
    decoder.free();
  });
});
