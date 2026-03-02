import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PEER_CONFIG,
  CHUNK_SIZE,
  BACKPRESSURE_HIGH,
  BACKPRESSURE_LOW,
} from "@/webrtc/types";

describe("WebRTC types", () => {
  it("has sensible default peer config", () => {
    expect(DEFAULT_PEER_CONFIG.host).toBe("0.peerjs.com");
    expect(DEFAULT_PEER_CONFIG.port).toBe(443);
    expect(DEFAULT_PEER_CONFIG.secure).toBe(true);
    expect(DEFAULT_PEER_CONFIG.stunServers).toContain(
      "stun:stun.l.google.com:19302",
    );
  });

  it("chunk size is 64 KB", () => {
    expect(CHUNK_SIZE).toBe(64 * 1024);
  });

  it("backpressure thresholds are correct", () => {
    expect(BACKPRESSURE_HIGH).toBe(1024 * 1024);
    expect(BACKPRESSURE_LOW).toBe(256 * 1024);
    expect(BACKPRESSURE_HIGH).toBeGreaterThan(BACKPRESSURE_LOW);
  });
});
