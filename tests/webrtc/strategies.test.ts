import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STRATEGIES,
  ALL_STRATEGIES,
  getAdapter,
  type StrategyName,
} from "@/webrtc/strategies";

describe("WebRTC strategies", () => {
  it("default strategies are nostr and torrent", () => {
    expect(DEFAULT_STRATEGIES).toEqual(["nostr", "torrent"]);
  });

  it("all strategies include mqtt", () => {
    expect(ALL_STRATEGIES).toEqual(["nostr", "torrent", "mqtt"]);
  });

  it("default strategies list is deterministic", () => {
    expect(DEFAULT_STRATEGIES[0]).toBe("nostr");
    expect(DEFAULT_STRATEGIES[1]).toBe("torrent");
  });

  it("getAdapter returns nostr adapter", async () => {
    const adapter = await getAdapter("nostr");
    expect(adapter.name).toBe("nostr");
    expect(typeof adapter.joinRoom).toBe("function");
  });

  it("getAdapter returns torrent adapter", async () => {
    const adapter = await getAdapter("torrent");
    expect(adapter.name).toBe("torrent");
    expect(typeof adapter.joinRoom).toBe("function");
  });

  it("getAdapter returns mqtt adapter", async () => {
    const adapter = await getAdapter("mqtt");
    expect(adapter.name).toBe("mqtt");
    expect(typeof adapter.joinRoom).toBe("function");
  });

  it("getAdapter throws for unknown strategy", async () => {
    await expect(getAdapter("unknown" as StrategyName)).rejects.toThrow(
      "Unknown strategy: unknown",
    );
  });
});
