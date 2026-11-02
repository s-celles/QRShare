import { describe, expect, it } from "bun:test";
import { estimateChatSeconds, estimateSessionFileSeconds } from "@/audio/link/estimate";
import { getProfile, packetDurationSec } from "@/audio/profiles";

const fast = getProfile("fast");
const robust = getProfile("robust");
const ultra = getProfile("ultrasonic");

describe("audio session time estimates (REQ-ALS-042)", () => {
  it("estimates a chat message: its packet, the turn waits and the acknowledgement", () => {
    const empty = estimateChatSeconds(0, fast, 2);
    const long = estimateChatSeconds(180, fast, 2);
    // At least the message packet itself (14 header + 4 + text + 16 tag + 4 CRC).
    expect(long).toBeGreaterThan(packetDurationSec(fast, 14 + 4 + 180 + 16 + 4));
    expect(long).toBeGreaterThan(empty);
    // A short message on Fast stays within a few seconds.
    const short = estimateChatSeconds(40, fast, 2);
    expect(short).toBeGreaterThan(2);
    expect(short).toBeLessThan(6);
  });

  it("is slower on Robust and much slower on Ultrasonic", () => {
    expect(estimateChatSeconds(80, robust, 2)).toBeGreaterThan(estimateChatSeconds(80, fast, 2));
    expect(estimateChatSeconds(80, ultra, 2)).toBeGreaterThan(estimateChatSeconds(80, robust, 2));
  });

  it("adds one acknowledgement per other member", () => {
    expect(estimateChatSeconds(80, fast, 4)).toBeGreaterThan(estimateChatSeconds(80, fast, 2));
  });

  it("estimates a session file from its size (sealed, padded) and grows with it", () => {
    const small = estimateSessionFileSeconds(100, fast);
    const big = estimateSessionFileSeconds(3000, fast);
    expect(small).toBeGreaterThan(5);
    expect(big).toBeGreaterThan(small * 3);
    // Padding: sizes in the same 256-byte step take the same time.
    expect(estimateSessionFileSeconds(10, fast)).toBe(estimateSessionFileSeconds(200, fast));
    expect(estimateSessionFileSeconds(1000, ultra)).toBeGreaterThan(estimateSessionFileSeconds(1000, fast) * 3);
  });
});
