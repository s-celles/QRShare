import { describe, expect, it } from "bun:test";
import {
  allowedSendModes,
  parseSendPolicy,
  recommendSendMode,
  STATIC_QR_MAX_BYTES,
  buildSendUrl,
  buildReceiverUrl,
  recommendSendModeForSize,
  describeAudioOption,
  cameraFromDevices,
  formatDuration,
  pickInvitationMode,
  type SendPolicy,
} from "@/ui/send-policy";
import { AUDIO_MAX_BYTES, AUDIO_SUGGESTED_MAX_BYTES, estimateDurationSec, getProfile } from "@/audio/profiles";

describe("URL send policy", () => {
  it("defaults to preferring air-gapped transfer", () => {
    expect(parseSendPolicy(null)).toBe("prefer-airgap");
    expect(parseSendPolicy("invalid")).toBe("prefer-airgap");
  });

  it("never exposes network modes under the airgap policy", () => {
    expect(allowedSendModes("airgap")).toEqual(["static-qr", "animated-qr", "cimbar", "audio"]);
    expect(recommendSendMode("x".repeat(STATIC_QR_MAX_BYTES + 1), "airgap"))
      .toBe("animated-qr");
  });

  it("uses a static QR when the UTF-8 payload fits", () => {
    expect(recommendSendMode("🌍", "airgap")).toBe("static-qr");
  });

  it("may recommend WebRTC for a large unrestricted payload", () => {
    expect(recommendSendMode("x".repeat(STATIC_QR_MAX_BYTES + 1), "any"))
      .toBe("webrtc");
  });

  it("builds an encoded URL without retaining an existing fragment", () => {
    const url = buildSendUrl("https://example.test/app/#/old", "a&b 🌍", "airgap");
    expect(url).toBe("https://example.test/app/#/send?data=a%26b+%F0%9F%8C%8D&policy=airgap");
  });

  it("builds receiver bootstrap links for each transfer mode", () => {
    expect(buildReceiverUrl("https://example.test/app/#/old", "static-qr", "airgap"))
      .toBe("https://example.test/app/#/scan?policy=airgap");
    expect(buildReceiverUrl("https://example.test/app/", "animated-qr", "airgap"))
      .toBe("https://example.test/app/#/receive/qr?policy=airgap");
    expect(buildReceiverUrl("https://example.test/app/", "webrtc", "any"))
      .toBe("https://example.test/app/#/receive/webrtc?policy=any");
    expect(buildReceiverUrl("https://example.test/app/", "cimbar", "airgap"))
      .toBe("https://example.test/app/#/receive/cimbar?policy=airgap");
    expect(buildReceiverUrl("https://example.test/app/#/x", "audio", "prefer-airgap"))
      .toBe("https://example.test/app/#/receive/audio?policy=prefer-airgap");
  });

  it("does not recommend static QR for files", () => {
    expect(recommendSendModeForSize(10, "airgap", false)).toBe("animated-qr");
  });
});

describe("audio transport policy (REQ-AUD-001..004, 006)", () => {
  const policies: SendPolicy[] = ["airgap", "prefer-airgap", "any"];

  it("offers audio under every policy when the payload fits the hard limit", () => {
    for (const policy of policies) {
      expect(allowedSendModes(policy, 10)).toContain("audio");
      expect(allowedSendModes(policy, AUDIO_MAX_BYTES)).toContain("audio");
      expect(allowedSendModes(policy)).toContain("audio");
    }
  });

  it("excludes audio above the hard limit", () => {
    for (const policy of policies) {
      expect(allowedSendModes(policy, AUDIO_MAX_BYTES + 1)).not.toContain("audio");
    }
    expect(allowedSendModes("any", AUDIO_MAX_BYTES + 1)).toEqual(["static-qr", "animated-qr", "cimbar", "webrtc", "share"]);
  });

  it("keeps audio an air-gapped mode (allowed under airgap, no network modes)", () => {
    expect(allowedSendModes("airgap", 100)).toEqual(["static-qr", "animated-qr", "cimbar", "audio"]);
  });

  it("never recommends audio when a camera is (or may be) available", () => {
    for (const policy of policies) {
      for (const size of [1, 500, AUDIO_SUGGESTED_MAX_BYTES, 5000]) {
        expect(recommendSendModeForSize(size, policy, true)).not.toBe("audio");
        expect(recommendSendModeForSize(size, policy, false, true)).not.toBe("audio");
        expect(recommendSendModeForSize(size, policy, true, undefined)).not.toBe("audio");
      }
      expect(recommendSendMode("hello", policy)).not.toBe("audio");
    }
  });

  it("recommends audio without a camera for payloads up to 1 KiB (Q5)", () => {
    for (const policy of policies) {
      expect(recommendSendModeForSize(200, policy, true, false)).toBe("audio");
      expect(recommendSendModeForSize(AUDIO_SUGGESTED_MAX_BYTES, policy, false, false)).toBe("audio");
      expect(recommendSendModeForSize(AUDIO_SUGGESTED_MAX_BYTES + 1, policy, true, false)).not.toBe("audio");
      expect(recommendSendMode("hello", policy, false)).toBe("audio");
    }
  });

  it("describes audio as suitable up to 1 KiB, slow above, unavailable past the limit", () => {
    const robust = getProfile("robust");
    const small = describeAudioOption(300);
    expect(small).toEqual({ allowed: true, suitable: true, estimatedSec: estimateDurationSec(300, robust) });
    const medium = describeAudioOption(4000);
    expect(medium.allowed).toBe(true);
    expect(medium.suitable).toBe(false);
    expect(medium.estimatedSec).toBeGreaterThan(small.estimatedSec);
    expect(describeAudioOption(AUDIO_MAX_BYTES + 1).allowed).toBe(false);
    expect(describeAudioOption(300, getProfile("fast")).estimatedSec).toBeLessThan(small.estimatedSec);
  });
});

describe("audio chooser helpers", () => {
  it("detects a camera from enumerateDevices output", () => {
    expect(cameraFromDevices([{ kind: "audioinput" }, { kind: "videoinput" }])).toBe(true);
    expect(cameraFromDevices([{ kind: "audioinput" }, { kind: "audiooutput" }])).toBe(false);
    // No device listed at all: unknown (never recommend audio on a guess).
    expect(cameraFromDevices([])).toBeUndefined();
  });

  it("formats durations in seconds then minutes", () => {
    expect(formatDuration(24.2)).toBe("25 s");
    expect(formatDuration(89)).toBe("89 s");
    expect(formatDuration(95)).toBe("2 min");
    expect(formatDuration(600)).toBe("10 min");
  });
});

describe("pickInvitationMode (review item 9)", () => {
  it("keeps the current mode while it stays allowed", () => {
    expect(pickInvitationMode("cimbar", "animated-qr", ["animated-qr", "cimbar", "audio"])).toBe("cimbar");
  });

  it("falls back to the recommendation when the current mode drops out", () => {
    expect(pickInvitationMode("audio", "animated-qr", ["animated-qr", "cimbar"])).toBe("animated-qr");
  });

  it("falls back to the first allowed mode when the recommendation is not allowed either", () => {
    expect(pickInvitationMode("audio", "static-qr", ["animated-qr", "cimbar"])).toBe("animated-qr");
  });
});
