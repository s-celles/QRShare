import { describe, expect, it } from "bun:test";
import {
  decryptPayloadECDH,
  encryptPayloadECDH,
  isEncryptedPayload,
  publicEcJwk,
  readFingerprintSlot,
} from "../../src/crypto/encryption";
import { parseStructuredQR } from "../../src/qr/structured";

const subtle = globalThis.crypto.subtle;

async function ecdhKeys() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  return {
    privateJwk: await subtle.exportKey("jwk", pair.privateKey),
    publicJwk: await subtle.exportKey("jwk", pair.publicKey),
  };
}

async function ecdsaPublicJwk() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return subtle.exportKey("jwk", pair.publicKey);
}

describe("REQ-SEC-008 contact encryption", () => {
  it("decrypts for a contact found by its fingerprint (the slot padding is ignored)", async () => {
    const ana = await ecdhKeys();
    const bob = await ecdhKeys();
    const data = new TextEncoder().encode("secret for Bob");

    const payload = await encryptPayloadECDH(data, ana.privateJwk, bob.publicJwk, "a1b2c3d4");
    expect(isEncryptedPayload(payload)).toBe(true);
    expect(payload[4]).toBe(2);

    // Bob's contact list holds Ana under her exact 8-character fingerprint.
    const contacts = new Map([["a1b2c3d4", ana.publicJwk]]);
    const clear = await decryptPayloadECDH(payload, bob.privateJwk, async (fp) => contacts.get(fp) ?? null);
    expect(new TextDecoder().decode(clear)).toBe("secret for Bob");
  });

  it("rejects a payload from an unknown sender", async () => {
    const ana = await ecdhKeys();
    const bob = await ecdhKeys();
    const payload = await encryptPayloadECDH(new Uint8Array([1, 2, 3]), ana.privateJwk, bob.publicJwk, "a1b2c3d4");
    await expect(decryptPayloadECDH(payload, bob.privateJwk, async () => null)).rejects.toThrow(
      "Unknown sender identity: a1b2c3d4",
    );
  });

  it("reads a fingerprint without its NUL padding", () => {
    const slot = new Uint8Array(64);
    slot.set(new TextEncoder().encode("deadbeef"));
    expect(readFingerprintSlot(slot)).toBe("deadbeef");
  });

  it("refuses a fingerprint longer than its slot", async () => {
    const ana = await ecdhKeys();
    const bob = await ecdhKeys();
    await expect(
      encryptPayloadECDH(new Uint8Array([1]), ana.privateJwk, bob.publicJwk, "x".repeat(65)),
    ).rejects.toThrow("Sender fingerprint too long");
  });

  it("carries the encryption key in an identity QR code, so a scanned contact can be encrypted for", async () => {
    const ecdh = await ecdhKeys();
    const payload = JSON.stringify({
      qrshare_identity: true,
      name: "Bob's phone",
      fingerprint: "a1b2c3d4",
      publicKeyJwk: publicEcJwk(await ecdsaPublicJwk()),
      ecdhPublicKeyJwk: publicEcJwk(ecdh.publicJwk),
    });
    // The identity code must fit the "balanced" preset used to show it (666 bytes).
    expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(666);

    const parsed = parseStructuredQR(payload);
    expect(parsed.kind).toBe("trusted-identity");
    if (parsed.kind !== "trusted-identity") return;
    expect(parsed.ecdhPublicKeyJwk).toEqual(publicEcJwk(ecdh.publicJwk));

    // The scanned key is enough to encrypt for Bob.
    const ana = await ecdhKeys();
    const sent = await encryptPayloadECDH(new Uint8Array([7]), ana.privateJwk, parsed.ecdhPublicKeyJwk!, "f00dcafe");
    const back = await decryptPayloadECDH(sent, ecdh.privateJwk, async () => ana.publicJwk);
    expect([...back]).toEqual([7]);
  });

  it("keeps reading identity codes made before the encryption key was added", () => {
    const parsed = parseStructuredQR(
      JSON.stringify({ qrshare_identity: true, name: "Old", fingerprint: "00000000", publicKeyJwk: { kty: "EC" } }),
    );
    expect(parsed.kind).toBe("trusted-identity");
    if (parsed.kind === "trusted-identity") expect(parsed.ecdhPublicKeyJwk).toBeUndefined();
  });
});
