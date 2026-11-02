/**
 * Sealed (password-encrypted) audio transfers.
 *
 * With a password, nothing readable goes on the air:
 * - the metadata packet carries the v3 frame (file name, real size, SHA-256, text
 *   flag, fountain parameters) encrypted with AES-256-GCM, bound by the AAD to the
 *   session id and the salt; a wrong password is detected from the first metadata
 *   packet heard;
 * - the fountain code carries `iv ‖ AES-GCM(len u32 ‖ compressed payload ‖ zero
 *   padding)`, the plaintext padded to a multiple of PAD_BUCKET, so the packet count
 *   only reveals the size bucket;
 * - the session id is random, so it cannot be linked to the content.
 *
 * The key is derived with PBKDF2-SHA256 (100,000 iterations, 16-byte random salt
 * sent in clear), as in `src/crypto/encryption.ts`.
 */

export const PAD_BUCKET = 256;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
const PBKDF2_ITERATIONS = 100_000;

const subtle = () => {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Web Crypto API is not available");
  return crypto.subtle;
};

const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveSealKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(sessionId: Uint8Array, salt: Uint8Array): Uint8Array {
  const out = new Uint8Array(sessionId.length + salt.length);
  out.set(sessionId);
  out.set(salt, sessionId.length);
  return out;
}

/** Encrypts the serialized metadata frame. */
export async function sealMetadata(
  frame: Uint8Array,
  key: CryptoKey,
  sessionId: Uint8Array,
  salt: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(aad(sessionId, salt)) }, key, bs(frame));
  return { iv, ciphertext: new Uint8Array(ct) };
}

/** Decrypts the metadata frame; null when the password (key) is wrong or the packet was forged. */
export async function openMetadata(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey,
  sessionId: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(aad(sessionId, salt)) }, key, bs(ciphertext));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}

/** Length of the sealed payload for `n` bytes of (compressed) data. */
export function sealedPayloadLength(n: number): number {
  return IV_BYTES + Math.max(1, Math.ceil((4 + n) / PAD_BUCKET)) * PAD_BUCKET + TAG_BYTES;
}

/** `iv ‖ AES-GCM(len ‖ data ‖ zero padding to a PAD_BUCKET multiple)`. */
export async function sealPayload(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const padded = new Uint8Array(sealedPayloadLength(data.length) - IV_BYTES - TAG_BYTES);
  new DataView(padded.buffer).setUint32(0, data.length, true);
  padded.set(data, 4);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(padded)));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

/** Inverse of `sealPayload`; throws when the payload does not authenticate. */
export async function openPayload(sealed: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = sealed.subarray(0, IV_BYTES);
  const pt = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(sealed.subarray(IV_BYTES))));
  const len = new DataView(pt.buffer).getUint32(0, true);
  if (len > pt.length - 4) throw new Error("Corrupted sealed payload");
  return pt.slice(4, 4 + len);
}
