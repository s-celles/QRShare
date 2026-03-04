import { describe, expect, it } from "bun:test";
import { configToToml, tomlToConfig, type AppConfig } from "@/config-toml";
import { DEFAULT_ICE_SERVERS } from "@/webrtc/settings";

const FULL_CONFIG: AppConfig = {
  app: { theme: "dark", language: "fr" },
  webrtc: {
    enabledStrategies: ["nostr", "torrent", "mqtt"],
    relayUrls: {
      nostr: ["wss://relay.damus.io", "wss://nos.lol"],
      torrent: ["wss://tracker.webtorrent.dev"],
      mqtt: ["wss://test.mosquitto.org:8081/mqtt"],
    },
    connectionMode: "parallel",
    iceServers: DEFAULT_ICE_SERVERS,
  },
};

describe("configToToml / tomlToConfig", () => {
  it("round-trips a full config", () => {
    const toml = configToToml(FULL_CONFIG);
    const parsed = tomlToConfig(toml);
    expect(parsed).toEqual(FULL_CONFIG);
  });

  it("round-trips with auto theme and auto language", () => {
    const config: AppConfig = {
      app: { theme: "auto", language: "auto" },
      webrtc: {
        enabledStrategies: ["nostr"],
        relayUrls: { nostr: ["wss://relay.example.com"], torrent: [], mqtt: [] },
        connectionMode: "sequential",
        iceServers: DEFAULT_ICE_SERVERS,
      },
    };
    const toml = configToToml(config);
    const parsed = tomlToConfig(toml);
    expect(parsed).toEqual(config);
  });

  it("handles missing [app] section with defaults", () => {
    const toml = `
[webrtc]
mode = "parallel"
strategies = ["nostr"]
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.theme).toBe("auto");
    expect(parsed.app.language).toBe("auto");
  });

  it("handles missing [webrtc] section with defaults", () => {
    const toml = `
[app]
theme = "light"
language = "en"
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.theme).toBe("light");
    expect(parsed.app.language).toBe("en");
    expect(parsed.webrtc.connectionMode).toBe("parallel");
    expect(parsed.webrtc.enabledStrategies).toEqual(["nostr", "torrent", "mqtt"]);
  });

  it("handles completely empty TOML", () => {
    const parsed = tomlToConfig("");
    expect(parsed.app.theme).toBe("auto");
    expect(parsed.app.language).toBe("auto");
    expect(parsed.webrtc.enabledStrategies).toEqual(["nostr", "torrent", "mqtt"]);
    expect(parsed.webrtc.connectionMode).toBe("parallel");
  });

  it("ignores unknown keys", () => {
    const toml = `
[app]
theme = "dark"
language = "en"
unknownKey = "value"

[webrtc]
mode = "parallel"
strategies = ["nostr"]
unknownField = 42

[unknown_section]
foo = "bar"
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.theme).toBe("dark");
    expect(parsed.app.language).toBe("en");
    expect(parsed.webrtc.enabledStrategies).toEqual(["nostr"]);
  });

  it("throws on malformed TOML strings", () => {
    expect(() => tomlToConfig('[app]\ntheme = "unclosed')).toThrow();
  });

  it("falls back to auto for invalid theme values", () => {
    const toml = `
[app]
theme = "neon"
language = "en"
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.theme).toBe("auto");
  });

  it("falls back to auto for invalid language values", () => {
    const toml = `
[app]
theme = "dark"
language = "de"
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.language).toBe("auto");
  });

  it("falls back to parallel for invalid connection mode", () => {
    const toml = `
[webrtc]
mode = "random"
strategies = ["nostr"]
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.webrtc.connectionMode).toBe("parallel");
  });

  it("filters out invalid strategy names", () => {
    const toml = `
[webrtc]
mode = "parallel"
strategies = ["nostr", "invalid", "mqtt"]
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.webrtc.enabledStrategies).toEqual(["nostr", "mqtt"]);
  });

  it("uses default strategies when all are invalid", () => {
    const toml = `
[webrtc]
mode = "parallel"
strategies = ["invalid1", "invalid2"]
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.webrtc.enabledStrategies).toEqual(["nostr", "torrent", "mqtt"]);
  });

  it("serializes relay URLs with proper TOML formatting", () => {
    const toml = configToToml(FULL_CONFIG);
    expect(toml).toContain("[webrtc.relays.nostr]");
    expect(toml).toContain('"wss://relay.damus.io"');
    expect(toml).toContain("[webrtc.relays.torrent]");
    expect(toml).toContain("[webrtc.relays.mqtt]");
  });

  it("omits relay sections for strategies with empty URLs", () => {
    const config: AppConfig = {
      app: { theme: "auto", language: "auto" },
      webrtc: {
        enabledStrategies: ["nostr"],
        relayUrls: { nostr: [], torrent: [], mqtt: [] },
        connectionMode: "parallel",
        iceServers: DEFAULT_ICE_SERVERS,
      },
    };
    const toml = configToToml(config);
    expect(toml).not.toContain("[webrtc.relays");
  });

  it("handles TOML with comments", () => {
    const toml = `
# Full config with comments
[app]
theme = "light" # user preference
language = "fr"

[webrtc]
mode = "sequential"
strategies = ["mqtt"] # only mqtt
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.app.theme).toBe("light");
    expect(parsed.app.language).toBe("fr");
    expect(parsed.webrtc.connectionMode).toBe("sequential");
    expect(parsed.webrtc.enabledStrategies).toEqual(["mqtt"]);
  });

  it("parses multi-line relay URL arrays", () => {
    const toml = `
[webrtc]
mode = "parallel"
strategies = ["nostr"]

[webrtc.relays.nostr]
urls = [
  "wss://relay1.example.com",
  "wss://relay2.example.com",
]
`;
    const parsed = tomlToConfig(toml);
    expect(parsed.webrtc.relayUrls.nostr).toEqual([
      "wss://relay1.example.com",
      "wss://relay2.example.com",
    ]);
  });
});
