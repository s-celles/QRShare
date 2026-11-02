import { describe, expect, it } from "bun:test";
import {
  AUDIO_PROFILES,
  AUDIO_MAX_BYTES,
  AUDIO_SUGGESTED_MAX_BYTES,
  META_INTERVAL,
  estimateNetBytesPerSecond,
  estimateDurationSec,
  getProfile,
  profileIndex,
  topToneHz,
  packetDurationSec,
  dataBodyLen,
  effectiveBlockSize,
} from "@/audio/profiles";

describe("audio profiles (REQ-AUD-051)", () => {
  it("defines robust, fast and ultrasonic with the design parameters", () => {
    expect(AUDIO_PROFILES.map((p) => p.id)).toEqual(["robust", "fast", "ultrasonic"]);
    const robust = getProfile("robust");
    expect(robust.baseHz).toBe(1500);
    expect(robust.toneSpacingHz).toBe(50);
    expect(robust.channels).toBe(6);
    expect(robust.windowSec + robust.guardSec).toBeCloseTo(0.06, 10);
    expect(robust.chirp.f0).toBeLessThan(robust.chirp.f1); // up-chirp
    expect(robust.lessReliable).toBe(false);

    const fast = getProfile("fast");
    expect(fast.windowSec + fast.guardSec).toBeCloseTo(0.03, 10);
    expect(fast.chirp.f0).toBeGreaterThan(fast.chirp.f1); // down-chirp
    expect(fast.toneSpacingHz).toBeCloseTo(1 / fast.windowSec, 6);

    const ultra = getProfile("ultrasonic");
    expect(ultra.baseHz).toBe(18500);
    expect(ultra.channels).toBe(2);
    expect(ultra.peak).toBeLessThanOrEqual(0.45);
    expect(getProfile("robust").peak).toBe(0.9);
    expect(ultra.windowSec + ultra.guardSec).toBeCloseTo(0.075, 10);
    expect(ultra.lessReliable).toBe(true);
    expect(ultra.minSampleRate).toBe(44100);
  });

  it("keeps ramps of at least 2 ms inside the guard (REQ-AUD-052)", () => {
    for (const p of AUDIO_PROFILES) {
      expect(p.rampSec).toBeGreaterThanOrEqual(0.002);
      expect(p.rampSec).toBeLessThanOrEqual(p.guardSec);
    }
  });

  it("keeps every tone and chirp below Nyquist at its minimum sample rate", () => {
    for (const p of AUDIO_PROFILES) {
      const nyquist = p.minSampleRate / 2;
      expect(topToneHz(p)).toBeLessThan(nyquist);
      expect(Math.max(p.chirp.f0, p.chirp.f1)).toBeLessThan(nyquist);
    }
    expect(topToneHz(getProfile("robust"))).toBe(6250);
    expect(topToneHz(getProfile("ultrasonic"))).toBe(19740);
  });

  it("indexes profiles for the packet header", () => {
    expect(profileIndex("robust")).toBe(0);
    expect(profileIndex("fast")).toBe(1);
    expect(profileIndex("ultrasonic")).toBe(2);
  });

  it("exposes the size limits and metadata interval", () => {
    expect(AUDIO_MAX_BYTES).toBe(8 * 1024);
    expect(AUDIO_SUGGESTED_MAX_BYTES).toBe(1024);
    expect(META_INTERVAL).toBe(8);
  });
});

const ULTRA_RATE = 5.28;

describe("throughput estimates (REQ-AUD-004)", () => {
  it("pins the net byte rates of each profile", () => {
    const robust = estimateNetBytesPerSecond(getProfile("robust"));
    const fast = estimateNetBytesPerSecond(getProfile("fast"));
    const ultra = estimateNetBytesPerSecond(getProfile("ultrasonic"));
    expect(robust).toBeGreaterThanOrEqual(20);
    expect(robust).toBeLessThanOrEqual(25);
    expect(fast).toBeGreaterThanOrEqual(50);
    expect(fast).toBeLessThanOrEqual(60);
    expect(ultra).toBeGreaterThanOrEqual(4);
    expect(ultra).toBeLessThanOrEqual(7);
    // Exact pinned values (documentation quotes these, rounded).
    expect(robust).toBeCloseTo(22.4, 1);
    expect(fast).toBeCloseTo(53.2, 1);
    expect(ultra).toBeCloseTo(ULTRA_RATE, 1);
  });

  it("computes packet airtime from the profile", () => {
    const robust = getProfile("robust");
    expect(dataBodyLen(robust.blockSize)).toBe(59);
    // chirp 0.1 + 0.01 + (3 header + 25 body symbols) × 0.06 + gap 0.08
    expect(packetDurationSec(robust, 59)).toBeCloseTo(1.87, 6);
  });

  it("applies the K >= 2 block size rule (REQ-AUD-077)", () => {
    expect(effectiveBlockSize(48, 1000)).toBe(48);
    expect(effectiveBlockSize(48, 60)).toBe(30);
    expect(effectiveBlockSize(48, 3)).toBe(1);
    expect(effectiveBlockSize(48, 1)).toBe(1);
  });

  it("estimates duration growing with size, lower for faster profiles", () => {
    const robust = getProfile("robust");
    const fast = getProfile("fast");
    const d600 = estimateDurationSec(600, robust);
    expect(d600).toBeGreaterThan(20);
    expect(d600).toBeLessThan(35);
    expect(estimateDurationSec(600, fast)).toBeLessThan(d600 / 2);
    expect(estimateDurationSec(1200, robust)).toBeGreaterThan(d600);
    expect(estimateDurationSec(600, robust, { codec: "lt" })).toBeGreaterThan(d600);
  });
});
