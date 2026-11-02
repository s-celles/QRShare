/**
 * Cryptography of audio sessions (REQ-ALS-003, 004, 010, 030).
 *
 * - Pairwise key: ECDH P-256 shared secret → HKDF-SHA256 (salt = room id) → AES-256-GCM,
 *   used only for the welcome that hands the group key to a new member.
 * - Group key: 32 random bytes → AES-256-GCM for every session packet; the nonce is
 *   built from the sender id, its packet counter and the kind, so it never repeats.
 * - Verification code: 4 digits from SHA-256 over the group key, the host public key and
 *   the member list (id + key fingerprint): a device in the middle yields other codes.
 */

const enc = new TextEncoder();
const subtle = () => crypto.subtle;
const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export interface LinkKeyPair {
  readonly privateKey: CryptoKey;
  /** Uncompressed P-256 point, 65 bytes. */
  readonly publicRaw: Uint8Array;
}

export interface MemberEntry {
  readonly id: number;
  /** First 8 bytes of SHA-256(public key). */
  readonly fp: Uint8Array;
}

export async function generateKeyPair(): Promise<LinkKeyPair> {
  const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicRaw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicRaw };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, usage: "aes" | "raw"): Promise<CryptoKey | Uint8Array> {
  const base = await subtle().importKey("raw", bs(ikm), "HKDF", false, ["deriveKey", "deriveBits"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(enc.encode(info)) };
  if (usage === "raw") return new Uint8Array(await subtle().deriveBits(params, base, 128));
  return subtle().deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** AES-GCM key shared by two devices (ECDH + HKDF, salt = room id). */
export async function pairwiseKey(privateKey: CryptoKey, peerPublicRaw: Uint8Array, roomId: Uint8Array): Promise<CryptoKey> {
  const peer = await subtle().importKey("raw", bs(peerPublicRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: peer }, privateKey, 256));
  return (await hkdf(secret, roomId, "qrshare-audio-link-pair", "aes")) as CryptoKey;
}

export function newGroupKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function importGroupKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", bs(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Nonce = from (4) ‖ counter (4) ‖ kind (1) ‖ 000. */
export function linkNonce(from: number, counter: number, kind: number): Uint8Array {
  const n = new Uint8Array(12);
  const v = new DataView(n.buffer);
  v.setUint32(0, from >>> 0);
  v.setUint32(4, counter >>> 0);
  n[8] = kind;
  return n;
}

export async function sealLink(key: CryptoKey, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad) }, key, bs(plain)));
}

/** null when the key, nonce or header do not match (or the packet was forged). */
export async function openLink(key: CryptoKey, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad) }, key, bs(sealed)));
  } catch {
    return null;
  }
}

export async function fingerprint(publicRaw: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", bs(publicRaw))).slice(0, 8);
}

/** 4-digit code shown on every member (REQ-ALS-004). */
export async function verificationCode(groupKey: Uint8Array, hostPublicRaw: Uint8Array, members: readonly MemberEntry[]): Promise<string> {
  const sorted = [...members].sort((a, b) => a.id - b.id);
  const label = enc.encode("qrshare-audio-link-code");
  const buf = new Uint8Array(label.length + 32 + hostPublicRaw.length + sorted.length * 12);
  let o = 0;
  buf.set(label, o); o += label.length;
  buf.set(groupKey, o); o += 32;
  buf.set(hostPublicRaw, o); o += hostPublicRaw.length;
  const v = new DataView(buf.buffer);
  for (const m of sorted) {
    v.setUint32(o, m.id >>> 0); o += 4;
    buf.set(m.fp, o); o += 8;
  }
  const h = new Uint8Array(await subtle().digest("SHA-256", buf));
  const n = new DataView(h.buffer).getUint32(0) % 10000;
  return n.toString().padStart(4, "0");
}

/** Password of the sealed transfers sent inside the session (REQ-ALS-030). */
export async function filePassword(groupKey: Uint8Array): Promise<string> {
  const raw = (await hkdf(groupKey, new Uint8Array(0), "qrshare-audio-link-file", "raw")) as Uint8Array;
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}
