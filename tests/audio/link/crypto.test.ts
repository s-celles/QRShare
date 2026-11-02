import { describe, expect, it } from "bun:test";
import {
  generateKeyPair,
  pairwiseKey,
  newGroupKey,
  importGroupKey,
  sealLink,
  openLink,
  fingerprint,
  verificationCode,
  filePassword,
  linkNonce,
} from "@/audio/link/crypto";

const ROOM = new Uint8Array([1, 2, 3, 4]);
const text = (s: string) => new TextEncoder().encode(s);

describe("link crypto (REQ-ALS-003, 004, 010)", () => {
  it("derives the same pairwise key on both sides (ECDH P-256 + HKDF)", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(a.publicRaw.length).toBe(65);
    const ka = await pairwiseKey(a.privateKey, b.publicRaw, ROOM);
    const kb = await pairwiseKey(b.privateKey, a.publicRaw, ROOM);
    const aad = text("hdr");
    const sealed = await sealLink(ka, linkNonce(7, 1, 3), aad, text("welcome"));
    expect(await openLink(kb, linkNonce(7, 1, 3), aad, sealed)).toEqual(text("welcome"));
  });

  it("a third party cannot open a pairwise message", async () => {
    const [a, b, m] = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
    const ka = await pairwiseKey(a.privateKey, b.publicRaw, ROOM);
    const km = await pairwiseKey(m.privateKey, a.publicRaw, ROOM);
    const sealed = await sealLink(ka, linkNonce(1, 1, 3), text("h"), text("secret"));
    expect(await openLink(km, linkNonce(1, 1, 3), text("h"), sealed)).toBeNull();
  });

  it("binds the header (AAD) and the nonce", async () => {
    const gk = newGroupKey();
    const key = await importGroupKey(gk);
    const sealed = await sealLink(key, linkNonce(5, 9, 5), text("header"), text("hello"));
    expect(sealed.length).toBe(5 + 16);
    expect(await openLink(key, linkNonce(5, 9, 5), text("HEADER"), sealed)).toBeNull();
    expect(await openLink(key, linkNonce(5, 10, 5), text("header"), sealed)).toBeNull();
  });

  it("builds unique 12-byte nonces from sender, counter and kind", () => {
    const n = linkNonce(0xdeadbeef, 0x01020304, 6);
    expect(n.length).toBe(12);
    expect(Array.from(n.subarray(0, 9))).toEqual([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 6]);
    expect(linkNonce(1, 2, 6)).not.toEqual(linkNonce(1, 3, 6));
  });

  it("computes 8-byte fingerprints and a 4-digit code that depends on every input", async () => {
    const host = await generateKeyPair();
    const guest = await generateKeyPair();
    const gk = newGroupKey();
    const members = [
      { id: 2, fp: await fingerprint(guest.publicRaw) },
      { id: 1, fp: await fingerprint(host.publicRaw) },
    ];
    expect(members[0].fp.length).toBe(8);
    const code = await verificationCode(gk, host.publicRaw, members);
    expect(code).toMatch(/^\d{4}$/);
    // Order of the list does not matter.
    expect(await verificationCode(gk, host.publicRaw, [...members].reverse())).toBe(code);
    const other = await generateKeyPair();
    const codes = new Set([
      code,
      await verificationCode(newGroupKey(), host.publicRaw, members),
      await verificationCode(gk, other.publicRaw, members),
      await verificationCode(gk, host.publicRaw, [members[0], { id: 1, fp: await fingerprint(other.publicRaw) }]),
    ]);
    expect(codes.size).toBeGreaterThanOrEqual(3); // 4-digit codes may collide 1/10000
  });

  it("derives a stable file password from the group key", async () => {
    const gk = newGroupKey();
    expect(await filePassword(gk)).toBe(await filePassword(gk));
    expect(await filePassword(gk)).not.toBe(await filePassword(newGroupKey()));
    expect(await filePassword(gk)).toMatch(/^[0-9a-f]{32}$/);
  });
});
