import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ROOM_CONFIG,
  ROOM_ID_LENGTH,
} from "@/webrtc/types";

describe("WebRTC types", () => {
  it("has sensible default room config", () => {
    expect(DEFAULT_ROOM_CONFIG.appId).toBe("qrshare-webrtc-v1");
    expect(DEFAULT_ROOM_CONFIG.relayRedundancy).toBe(3);
  });

  it("room ID length is 6", () => {
    expect(ROOM_ID_LENGTH).toBe(6);
  });
});
