import { describe, expect, it } from "bun:test";
import { encodeFlags, decodeFlags, FLAG_TEXT, FLAG_WIREHAIR } from "@/protocol/frame";

describe("frame flags (REQ-AUD-075)", () => {
  it("defines the Wirehair flag as 0x02", () => {
    expect(FLAG_WIREHAIR).toBe(0x02);
    expect(FLAG_TEXT).toBe(0x01);
  });

  it("round-trips the codec without affecting isText", () => {
    for (const isText of [false, true]) {
      for (const codec of ["lt", "wirehair"] as const) {
        const decoded = decodeFlags(encodeFlags({ isText, codec }));
        expect(decoded.isText).toBe(isText);
        expect(decoded.codec).toBe(codec);
      }
    }
  });

  it("defaults to LT when the flag is absent, so QR frames are unchanged on the wire", () => {
    expect(encodeFlags({ isText: true })).toBe(0x01);
    expect(encodeFlags({ isText: false })).toBe(0x00);
    expect(decodeFlags(0x00).codec).toBe("lt");
    expect(decodeFlags(0x01).codec).toBe("lt");
    expect(decodeFlags(0x03)).toEqual({ isText: true, codec: "wirehair" });
  });
});
