import { describe, expect, it } from "bun:test";
import { decodeFidoDigits, encodeFidoDigits, isFidoUri, parseFidoUri } from "@/qr/fido";
import { parseStructuredQR } from "@/qr/structured";

/** CBOR head for a major type and a small argument. */
const head = (major: number, n: number): number[] =>
  n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const bytes = (b: number[]) => [...head(2, b.length), ...b];
const text = (s: string) => {
  const b = [...new TextEncoder().encode(s)];
  return [...head(3, b.length), ...b];
};

const publicKey = [0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)];
const secret = Array.from({ length: 16 }, (_, i) => 0xa0 + i);

/** The CBOR map of a hybrid code, as CTAP 2.2 §11.5 describes it. */
function hybridCbor(entries: { time?: number; state?: boolean; hint?: string; domains?: number } = {}): Uint8Array {
  const items: number[][] = [
    [...head(0, 0), ...bytes(publicKey)],
    [...head(0, 1), ...bytes(secret)],
    [...head(0, 2), ...head(0, entries.domains ?? 2)],
  ];
  if (entries.time !== undefined) items.push([...head(0, 3), ...head(0, entries.time)]);
  if (entries.state !== undefined) items.push([...head(0, 4), entries.state ? 0xf5 : 0xf4]);
  if (entries.hint !== undefined) items.push([...head(0, 5), ...text(entries.hint)]);
  return new Uint8Array([...head(5, items.length), ...items.flat()]);
}

describe("FIDO digit encoding", () => {
  it("writes 7 bytes as 17 little-endian decimal digits and shorter tails with fewer digits", () => {
    expect(encodeFidoDigits(new Uint8Array([]))).toBe("");
    expect(encodeFidoDigits(new Uint8Array([1]))).toBe("001");
    expect(encodeFidoDigits(new Uint8Array([0xff]))).toBe("255");
    expect(encodeFidoDigits(new Uint8Array([1, 0, 0, 0, 0, 0, 0]))).toBe("00000000000000001");
    expect(encodeFidoDigits(new Uint8Array([0, 1]))).toBe("00256");
  });

  it("decodes what it encodes, for every tail length", () => {
    for (let n = 0; n <= 30; n++) {
      const data = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
      expect(decodeFidoDigits(encodeFidoDigits(data))).toEqual(data);
    }
  });

  it("rejects digit strings of an impossible length, too large a chunk, or other characters", () => {
    expect(decodeFidoDigits("1234")).toBeNull(); // no tail has 4 digits
    expect(decodeFidoDigits("256")).toBeNull(); // more than one byte
    expect(decodeFidoDigits("12a")).toBeNull();
  });
});

describe("REQ-STRUCT-007 FIDO hybrid sign-in codes", () => {
  const uri = (cbor: Uint8Array) => `FIDO:/${encodeFidoDigits(cbor)}`;

  it("recognises the FIDO:/ prefix, in any case", () => {
    expect(isFidoUri("FIDO:/123")).toBe(true);
    expect(isFidoUri("  fido:/123")).toBe(true);
    expect(isFidoUri("https://example.org")).toBe(false);
  });

  it("decodes the computer's key, the secret, the time and the request", () => {
    const code = parseFidoUri(uri(hybridCbor({ time: 1_759_000_000, state: true, hint: "ga" })));
    expect(code).not.toBeNull();
    expect([...code!.publicKey]).toEqual(publicKey);
    expect([...code!.secret]).toEqual(secret);
    expect(code!.tunnelServerDomains).toBe(2);
    expect(code!.createdAt?.toISOString()).toBe(new Date(1_759_000_000_000).toISOString());
    expect(code!.stateAssisted).toBe(true);
    expect(code!.request).toBe("sign-in");
  });

  it("tells a passkey creation apart, and tolerates the optional fields being absent", () => {
    expect(parseFidoUri(uri(hybridCbor({ hint: "mc" })))!.request).toBe("register");
    const minimal = parseFidoUri(uri(hybridCbor()))!;
    expect(minimal.request).toBe("unknown");
    expect(minimal.createdAt).toBeUndefined();
  });

  it("rejects codes whose content is not a well-formed hybrid code", () => {
    expect(parseFidoUri("FIDO:/")).toBeNull();
    expect(parseFidoUri("FIDO:/1234")).toBeNull();
    // A map without the secret.
    expect(parseFidoUri(uri(new Uint8Array([...head(5, 1), ...head(0, 0), ...bytes(publicKey)])))).toBeNull();
    // Trailing bytes after the map.
    expect(parseFidoUri(uri(new Uint8Array([...hybridCbor(), 0x00])))).toBeNull();
    // A truncated map.
    expect(parseFidoUri(uri(hybridCbor().subarray(0, 20)))).toBeNull();
  });

  it("shows a valid code as a passkey card and anything else under FIDO:/ as text", () => {
    expect(parseStructuredQR(uri(hybridCbor({ hint: "ga" }))).kind).toBe("fido");
    expect(parseStructuredQR("FIDO:/garbage").kind).toBe("text");
  });
});
