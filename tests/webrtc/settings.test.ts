import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STRATEGY_SETTINGS,
  DEFAULT_ICE_SERVERS,
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

  it("default settings have nostr relay URLs", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.nostr.length).toBeGreaterThan(0);
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.nostr[0]).toMatch(/^wss:\/\//);
  });

  it("default settings have mqtt relay URLs entry (lazy-loaded)", () => {
    expect(DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt).toBeDefined();
    expect(Array.isArray(DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt)).toBe(true);
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
        iceServers: DEFAULT_ICE_SERVERS,
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
        iceServers: DEFAULT_ICE_SERVERS,
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

describe("no default TURN server [REQ-RELY-050, REQ-RELY-051]", () => {
  // QRShare deliberately ships no relay: a TURN server observes connection
  // metadata (who pairs with whom, when, how much) even though DTLS keeps the
  // payload opaque. This guard exists so one cannot be added inadvertently.
  const urlsOf = (s: { urls: string | string[] }) =>
    Array.isArray(s.urls) ? s.urls : [s.urls];

  it("DEFAULT_ICE_SERVERS contains no turn: or turns: URL", () => {
    for (const server of DEFAULT_ICE_SERVERS) {
      for (const url of urlsOf(server)) {
        expect(url.startsWith("turn:")).toBe(false);
        expect(url.startsWith("turns:")).toBe(false);
      }
    }
  });

  it("the default settings blob ships no TURN either", () => {
    for (const server of DEFAULT_STRATEGY_SETTINGS.iceServers) {
      for (const url of urlsOf(server)) {
        expect(url.startsWith("turn")).toBe(false);
      }
    }
  });

  it("the defaults do still ship STUN (direct P2P must work where it can)", () => {
    const all = DEFAULT_ICE_SERVERS.flatMap(urlsOf);
    expect(all.some((u) => u.startsWith("stun:"))).toBe(true);
  });
});
