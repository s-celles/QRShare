import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STRATEGY_SETTINGS,
  buildRoomConfig,
  resetStrategySettings,
  strategySettings,
} from "@/webrtc/settings";

describe("WebRTC settings", () => {
  it("default settings enable all three strategies", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.enabledStrategies).toEqual([
      "nostr",
      "torrent",
      "mqtt",
    ]);
  });

  it("default settings use parallel mode", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.connectionMode).toBe("parallel");
  });

  it("default settings have torrent relay URLs", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.torrent.length).toBeGreaterThan(0);
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.torrent[0]).toMatch(/^wss:\/\//);
  });

  it("default settings have empty nostr and mqtt relay URLs", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.nostr).toEqual([]);
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt).toEqual([]);
  });

  it("buildRoomConfig produces a valid RoomConfig", () => {
    const config = buildRoomConfig();
    expect(config.appId).toBe("qrshare-webrtc-v1");
    expect(config.relayRedundancy).toBe(3);
    expect(config.strategies).toBeDefined();
    expect(config.relayUrls).toBeDefined();
    expect(config.connectionMode).toBeDefined();
  });

  it("buildRoomConfig reflects current settings", () => {
    const original = strategySettings.value;
    try {
      strategySettings.value = {
        enabledStrategies: ["torrent"],
        relayUrls: {
          nostr: [],
          torrent: ["wss://custom.tracker.test"],
          mqtt: [],
        },
        connectionMode: "sequential",
      };
      const config = buildRoomConfig();
      expect(config.strategies).toEqual(["torrent"]);
      expect(config.relayUrls?.torrent).toEqual(["wss://custom.tracker.test"]);
      expect(config.connectionMode).toBe("sequential");
    } finally {
      strategySettings.value = original;
    }
  });

  it("resetStrategySettings restores defaults", () => {
    const original = strategySettings.value;
    try {
      strategySettings.value = {
        enabledStrategies: ["mqtt"],
        relayUrls: { nostr: [], torrent: [], mqtt: ["wss://test"] },
        connectionMode: "sequential",
      };
      resetStrategySettings();
      expect(strategySettings.value.enabledStrategies).toEqual(
        DEFAULT_STRATEGY_SETTINGS.enabledStrategies,
      );
      expect(strategySettings.value.connectionMode).toBe("parallel");
    } finally {
      strategySettings.value = original;
    }
  });
});
