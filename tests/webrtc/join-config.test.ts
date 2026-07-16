import { describe, expect, it } from "bun:test";
import { buildJoinConfig } from "@/webrtc/service";
import type { RoomConfig } from "@/webrtc/types";
import type { StrategyAdapter } from "@/webrtc/strategies";

// trystero builds the RTCPeerConnection as:
//   new RTCPeerConnection({ iceServers: defaultIceServers.concat(turnConfig || []), ...rtcConfig })
// Because `rtcConfig` is spread AFTER `iceServers`, anything we put in
// `rtcConfig.iceServers` overrides the defaults AND the turnConfig concat.
// So rtcConfig.iceServers must carry every server we want ICE to actually use.

const adapter: StrategyAdapter = {
  name: "nostr",
  joinRoom: (() => ({})) as unknown as StrategyAdapter["joinRoom"],
};

const base: RoomConfig = {
  appId: "test-app",
  relayRedundancy: 3,
};

const build = (iceServers: RoomConfig["iceServers"]) =>
  buildJoinConfig({ ...base, iceServers }, adapter, "room42");

describe("buildJoinConfig ICE handling", () => {
  it("passes TURN servers through to rtcConfig.iceServers (not only turnConfig)", () => {
    const cfg = build([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
    ]);

    const urls = cfg.rtcConfig?.iceServers.map((s) => s.urls) ?? [];
    expect(urls).toContain("turn:turn.example.com:3478");
    expect(urls).toContain("stun:stun.l.google.com:19302");
  });

  it("preserves TURN credentials in rtcConfig.iceServers", () => {
    const cfg = build([
      { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
    ]);

    const turn = cfg.rtcConfig?.iceServers.find(
      (s) => s.urls === "turn:turn.example.com:3478",
    );
    expect(turn?.username).toBe("user");
    expect(turn?.credential).toBe("pass");
  });

  it("never yields an empty iceServers list when only TURN is configured", () => {
    const cfg = build([
      { urls: "turns:turn.example.com:5349", username: "u", credential: "c" },
    ]);

    // Previously rtcConfig.iceServers was built from STUN only, so a TURN-only
    // config produced [] and wiped out every ICE server.
    expect(cfg.rtcConfig?.iceServers.length).toBeGreaterThan(0);
  });

  it("supports urls given as an array", () => {
    const cfg = build([
      { urls: ["turn:turn.example.com:3478", "turn:turn.example.com:5349"], username: "u", credential: "c" },
    ]);

    expect(cfg.rtcConfig?.iceServers).toHaveLength(1);
    expect(cfg.rtcConfig?.iceServers[0].urls).toEqual([
      "turn:turn.example.com:3478",
      "turn:turn.example.com:5349",
    ]);
  });

  it("leaves rtcConfig unset when no ICE servers are configured, so trystero defaults apply", () => {
    const cfg = build([]);
    expect(cfg.rtcConfig).toBeUndefined();
  });

  it("still carries the room/relay settings", () => {
    const cfg = buildJoinConfig(
      { ...base, relayUrls: { nostr: ["wss://relay.example"] } },
      adapter,
      "room42",
    );
    expect(cfg.password).toBe("room42");
    expect(cfg.appId).toBe("test-app");
    expect(cfg.relayUrls).toEqual(["wss://relay.example"]);
  });
});
