import { describe, expect, it } from "bun:test";
import { CODE_LENGTH, SECRET_BYTES, codeToSecret, formatCode, newRoomSecret, normalizeCode, pasteLink, readPasteLink, secretToCode } from "@/paste/code";

describe("REQ-PASTE-001 room code", () => {
  it("generates an 80-bit secret shown as 16 Crockford characters in four groups", () => {
    const secret = newRoomSecret();
    expect(secret.length).toBe(SECRET_BYTES);
    expect(SECRET_BYTES * 8).toBe(80);
    const code = secretToCode(secret);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(code.replace(/-/g, "").length).toBe(CODE_LENGTH);
  });

  it("round-trips every secret", () => {
    for (let i = 0; i < 200; i++) {
      const secret = newRoomSecret();
      expect([...codeToSecret(secretToCode(secret))!]).toEqual([...secret]);
    }
    expect(secretToCode(new Uint8Array(10))).toBe("0000-0000-0000-0000");
    expect(secretToCode(new Uint8Array(10).fill(255))).toBe("ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  });

  it("builds a paste link carrying the code", () => {
    const code = secretToCode(new Uint8Array(10).fill(7));
    const link = pasteLink("https://example.org/app/", code);
    expect(link).toBe(`https://example.org/app/#/paste?k=${code.replace(/-/g, "")}`);
    expect(readPasteLink(link)).toBe(code);
    expect(readPasteLink("https://example.org/#/collab?k=x")).toBeNull();
  });
});

describe("REQ-PASTE-002 code normalisation", () => {
  const code = secretToCode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

  it("accepts lower case, spaces, dashes and underscores", () => {
    expect(normalizeCode(code.toLowerCase())).toBe(code);
    expect(normalizeCode(code.replace(/-/g, " "))).toBe(code);
    expect(normalizeCode(` ${code.replace(/-/g, "_")} `)).toBe(code);
    expect(normalizeCode(code.replace(/-/g, ""))).toBe(code);
  });

  it("maps I and L to 1 and O to 0", () => {
    expect(normalizeCode("ilo0-0000-0000-0000")).toBe("1100-0000-0000-0000");
  });

  it("rejects bad lengths and characters", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("0000-0000-0000-000")).toBeNull();
    expect(normalizeCode("0000-0000-0000-00000")).toBeNull();
    expect(normalizeCode("0000-0000-0000-000U")).toBeNull();
    expect(normalizeCode("0000-0000-0000-000!")).toBeNull();
    expect(codeToSecret("nope")).toBeNull();
  });

  it("formats a bare code in groups", () => {
    expect(formatCode("ABCDEFGHJKMNPQRS")).toBe("ABCD-EFGH-JKMN-PQRS");
  });
});
