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

describe("TURN servers via [[webrtc.ice.turn]] array-of-tables", () => {
  // The exporter writes `[[webrtc.ice.turn]]`, so the parser must read it back or
  // an export/import round-trip silently drops every TURN server.
  const withTurn = `
[webrtc]
mode = "parallel"
strategies = ["nostr"]

[webrtc.ice]
stun = ["stun:stun.l.google.com:19302"]

[[webrtc.ice.turn]]
urls = "turn:turn.example.com:3478"
username = "alice"
credential = "s3cret"
`;

  const turnOf = (config: ReturnType<typeof tomlToConfig>) =>
    config.webrtc.iceServers.filter((s) => String(s.urls).startsWith("turn"));

  it("imports a TURN server with its credentials", () => {
    const turn = turnOf(tomlToConfig(withTurn));
    expect(turn).toHaveLength(1);
    expect(turn[0]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "alice",
      credential: "s3cret",
    });
  });

  it("keeps the STUN servers alongside", () => {
    const config = tomlToConfig(withTurn);
    expect(config.webrtc.iceServers.some((s) => String(s.urls).startsWith("stun:"))).toBe(true);
  });

  it("imports several TURN servers", () => {
    const config = tomlToConfig(`
[webrtc.ice]
stun = ["stun:a.example.com:3478"]

[[webrtc.ice.turn]]
urls = "turn:one.example.com:3478"
username = "u1"
credential = "c1"

[[webrtc.ice.turn]]
urls = "turns:two.example.com:5349"
username = "u2"
credential = "c2"
`);
    const turn = turnOf(config);
    expect(turn.map((s) => s.urls)).toEqual([
      "turn:one.example.com:3478",
      "turns:two.example.com:5349",
    ]);
    expect(turn[1].username).toBe("u2");
  });

  it("survives an export -> import round-trip", () => {
    const original = tomlToConfig(withTurn);
    const restored = tomlToConfig(configToToml(original));
    // Guard: without this the assertion below passes vacuously when both sides
    // have dropped every TURN server — which is exactly the bug.
    expect(turnOf(original)).toHaveLength(1);
    expect(turnOf(restored)).toEqual(turnOf(original));
  });

  it("does not leak the turn keys into the ice table", () => {
    // The old parser ignored the [[...]] header and dumped urls/username into
    // whatever section was current — i.e. [webrtc.ice].
    const config = tomlToConfig(withTurn);
    expect(config.webrtc.iceServers.some((s) => s.urls === "")).toBe(false);
  });

  it("a TURN entry with no url is skipped", () => {
    const config = tomlToConfig(`
[webrtc.ice]
stun = ["stun:a.example.com:3478"]

[[webrtc.ice.turn]]
username = "u"
credential = "c"
`);
    expect(turnOf(config)).toHaveLength(0);
  });
});
