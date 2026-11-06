/**
 * Paste-board frames (REQ-PASTE-060, 061, 075):
 *
 *   [version u8 = 1][type u8][nonce 12][AES-256-GCM(content key, plaintext) ‖ tag 16]
 *   AAD = bytes [0, 2)
 *
 * Control frames travel on the `paste` action, attachments on `pblob`.
 */
import { MAX_FILE_BYTES } from "./statement";

export enum FrameType {
  INV = 1,
  WANT = 2,
  ITEM = 3,
  PROOF = 4,
  DIGEST = 5,
  BLOB_WANT = 6,
  BLOB = 7,
}

export type PasteAction = "paste" | "pblob";
export const ACTION_CONTROL: PasteAction = "paste";
export const ACTION_BLOB: PasteAction = "pblob";

const VERSION = 1;
const OVERHEAD = 2 + 12 + 16;
export const MAX_CONTROL_FRAME = 64 * 1024;
export const MAX_BLOB_FRAME = MAX_FILE_BYTES + 1024;
export const MAX_PROOF_BYTES = 16 * 1024;
/** Ids fitting a control frame. */
export const MAX_IDS_PER_FRAME = Math.floor((MAX_CONTROL_FRAME - OVERHEAD) / 32);

const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export function actionOf(type: FrameType): PasteAction {
  return type === FrameType.BLOB ? ACTION_BLOB : ACTION_CONTROL;
}

/** Checked before decryption. */
export function frameSizeOk(action: PasteAction, size: number): boolean {
  return size >= OVERHEAD && size <= (action === ACTION_BLOB ? MAX_BLOB_FRAME : MAX_CONTROL_FRAME);
}

export async function sealFrame(key: CryptoKey, type: FrameType, plaintext: Uint8Array): Promise<Uint8Array> {
  const header = Uint8Array.from([VERSION, type]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: header }, key, bs(plaintext)));
  const out = new Uint8Array(14 + sealed.length);
  out.set(header);
  out.set(nonce, 2);
  out.set(sealed, 14);
  return out;
}

/** null when the frame is not ours, forged, tampered with, or of an unknown version or type. */
export async function openFrame(key: CryptoKey, frame: Uint8Array): Promise<{ type: FrameType; plaintext: Uint8Array } | null> {
  if (frame.length < OVERHEAD || frame[0] !== VERSION || frame[1] < FrameType.INV || frame[1] > FrameType.BLOB) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bs(frame.subarray(2, 14)), additionalData: bs(frame.subarray(0, 2)) },
      key,
      bs(frame.subarray(14)),
    );
    return { type: frame[1] as FrameType, plaintext: new Uint8Array(plaintext) };
  } catch {
    return null;
  }
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** n × 32-byte ids, sorted. */
export function encodeIdList(ids: Uint8Array[]): Uint8Array {
  const sorted = [...ids].sort(compareBytes);
  const out = new Uint8Array(sorted.length * 32);
  sorted.forEach((id, i) => out.set(id, i * 32));
  return out;
}

export function decodeIdList(bytes: Uint8Array): Uint8Array[] | null {
  if (bytes.length % 32) return null;
  const ids: Uint8Array[] = [];
  for (let o = 0; o < bytes.length; o += 32) ids.push(bytes.slice(o, o + 32));
  return ids;
}

/** DIGEST: count u16 · SHA-256(sorted ids). */
export function encodeDigest(count: number, hash: Uint8Array): Uint8Array {
  const out = new Uint8Array(34);
  out[0] = (count >> 8) & 255;
  out[1] = count & 255;
  out.set(hash, 2);
  return out;
}

export function decodeDigest(bytes: Uint8Array): { count: number; hash: Uint8Array } | null {
  if (bytes.length !== 34) return null;
  return { count: (bytes[0] << 8) | bytes[1], hash: bytes.slice(2) };
}

/** PROOF: paste id 32 · author signature 64 (see proof-share.ts) · .ots bytes (≤ 16 KiB). */
export function encodeProof(id: Uint8Array, signature: Uint8Array, ots: Uint8Array): Uint8Array {
  const out = new Uint8Array(96 + ots.length);
  out.set(id);
  out.set(signature, 32);
  out.set(ots, 96);
  return out;
}

export function decodeProof(bytes: Uint8Array): { id: Uint8Array; signature: Uint8Array; ots: Uint8Array } | null {
  if (bytes.length <= 96 || bytes.length > 96 + MAX_PROOF_BYTES) return null;
  return { id: bytes.slice(0, 32), signature: bytes.slice(32, 96), ots: bytes.slice(96) };
}

/** BLOB: hash 32 · bytes. */
export function encodeBlob(hash: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(32 + data.length);
  out.set(hash);
  out.set(data, 32);
  return out;
}

export function decodeBlob(bytes: Uint8Array): { hash: Uint8Array; bytes: Uint8Array } | null {
  if (bytes.length < 32) return null;
  return { hash: bytes.slice(0, 32), bytes: bytes.slice(32) };
}
