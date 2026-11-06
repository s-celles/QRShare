/**
 * Paste-board keys (REQ-PASTE-004, 010, 011, 062).
 *
 * Everything derives from the 80-bit room secret with HKDF-SHA256 (salt
 * "qrshare-paste-v1", one label per use); the secret itself never leaves the device.
 * Authors sign with an ephemeral Ed25519 key that lives in memory for one board only,
 * unrelated to the persistent identity (`src/crypto/identity.ts`) or the contacts.
 */
import { createIdentity, type Identity } from "@/collab/core/identity";
import { generatePeerKey, type PeerKey } from "@/collab/core/offline/peers";

export const PASTE_APP_ID = "qrshare-paste-v1";

const enc = new TextEncoder();
const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export interface RoomKeys {
  /** Trystero room id (hex of 16 bytes): relays only see a hash of it. */
  roomId: string;
  /** Trystero password (hex of 16 bytes): encrypts the SDP offers and answers. */
  password: string;
  /** AES-256-GCM key of every board frame (non-extractable). */
  contentKey: CryptoKey;
  /** 16 bytes inside every signed statement: no replay across boards. */
  tag: Uint8Array;
}

function hkdfParams(label: string) {
  return { name: "HKDF", hash: "SHA-256", salt: bs(enc.encode(PASTE_APP_ID)), info: bs(enc.encode(label)) };
}

export async function deriveRoomKeys(secret: Uint8Array): Promise<RoomKeys> {
  const base = await crypto.subtle.importKey("raw", bs(secret), "HKDF", false, ["deriveKey", "deriveBits"]);
  const bits = async (label: string) => new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(label), base, 128));
  const contentKey = await crypto.subtle.deriveKey(hkdfParams("content"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { roomId: toHex(await bits("room")), password: toHex(await bits("signal")), contentKey, tag: await bits("tag") };
}

/** How an author key is shown: 8-hex fingerprint, pseudonym and colour (REQ-PASTE-011). */
export interface AuthorView {
  fingerprint: string;
  identity: Identity;
}

export async function describeAuthor(publicKey: Uint8Array): Promise<AuthorView> {
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bs(publicKey))));
  return { fingerprint: digest.slice(0, 8), identity: createIdentity(digest) };
}

export interface Author extends AuthorView {
  key: PeerKey;
}

/** A new session key (never stored), with its pseudonym. */
export async function createAuthor(): Promise<Author> {
  const key = await generatePeerKey();
  return { key, ...(await describeAuthor(key.publicKey)) };
}

/** Whether WebCrypto Ed25519 is available (the board is refused otherwise). */
export async function supportsEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}
