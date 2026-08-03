import { describe, expect, it } from "bun:test";
import {
  allowedSendModes,
  parseSendPolicy,
  recommendSendMode,
  STATIC_QR_MAX_BYTES,
  buildSendUrl,
  buildReceiverUrl,
  recommendSendModeForSize,
} from "@/ui/send-policy";

describe("URL send policy", () => {
  it("defaults to preferring air-gapped transfer", () => {
    expect(parseSendPolicy(null)).toBe("prefer-airgap");
    expect(parseSendPolicy("invalid")).toBe("prefer-airgap");
  });

  it("never exposes network modes under the airgap policy", () => {
    expect(allowedSendModes("airgap")).toEqual(["static-qr", "animated-qr"]);
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
  });

  it("does not recommend static QR for files", () => {
    expect(recommendSendModeForSize(10, "airgap", false)).toBe("animated-qr");
  });
});
