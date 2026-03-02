import type { FountainCodecFactory } from "./types";
import { WirehairCodecFactory } from "./wirehair-adapter";
import { LTCodecFactory } from "./lt-adapter";

let cachedFactory: FountainCodecFactory | null = null;

export async function getCodecFactory(): Promise<FountainCodecFactory> {
  if (cachedFactory) return cachedFactory;

  const wirehair = new WirehairCodecFactory();
  if (wirehair.isWasmAvailable()) {
    try {
      // Test that we can actually create an encoder
      const enc = await wirehair.createEncoder();
      enc.free();
      cachedFactory = wirehair;
      return wirehair;
    } catch {
      // WASM available but wirehair failed to init, fall back
    }
  }

  cachedFactory = new LTCodecFactory();
  return cachedFactory;
}
