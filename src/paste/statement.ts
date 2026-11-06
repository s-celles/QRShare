/**
 * The signed statement of a paste (REQ-PASTE-012, 013, 020, 021, 034, 054): the
 * unit that is signed, identified (paste id = SHA-256 of the statement), timestamped
 * with OpenTimestamps and downloaded as `paste-<id>.statement`.
 *
 *   "QPST" · version 1 · room tag 16 · Ed25519 public key 32 · declared ms u64 BE ·
 *   format u8 (1 text, 2 markdown) · source length u32 BE · source (UTF-8, LF, no BOM) ·
 *   attachment count u8 · per attachment: sha256 32 · size u32 · mime len u8 + mime ·
 *   name len u8 + name · width u16 · height u16
 *
 * An ITEM frame carries statement ‖ 64-byte signature over the statement.
 */
import { sanitizeFilename } from "./attachments/filename";

export const MAX_SOURCE_BYTES = 16 * 1024;
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAGIC = [0x51, 0x50, 0x53, 0x54]; // "QPST"
const VERSION = 1;
const HEADER = 66;
const MIME_TOKEN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

export class StatementError extends Error {}

export type PasteFormat = "text" | "markdown";

export interface AttachmentRef {
  /** SHA-256 of the attachment bytes. */
  hash: Uint8Array;
  size: number;
  /** Declared MIME type (never used to decide how to show the attachment). */
  mime: string;
  /** Sanitised file name. */
  name: string;
  /** Pixels for images, 0 otherwise. */
  width: number;
  height: number;
}

export interface StatementFields {
  tag: Uint8Array;
  author: Uint8Array;
  declaredAt: number;
  format: PasteFormat;
  source: string;
  attachments: AttachmentRef[];
}

const enc = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

/** The canonical source: LF line endings, no BOM, no Unicode normalisation (REQ-PASTE-021). */
export function normalizeSource(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function utf8Length(text: string): number {
  return enc.encode(text).length;
}

function checkAttachment(a: AttachmentRef): void {
  if (a.hash.length !== 32) throw new StatementError("Attachment hash must be 32 bytes");
  if (!Number.isInteger(a.size) || a.size < 0) throw new StatementError("Bad attachment size");
  const image = a.width > 0 || a.height > 0;
  if (a.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) throw new StatementError("Attachment too large");
  if (!MIME_TOKEN.test(a.mime)) throw new StatementError("Bad attachment MIME type");
  if (!a.name || sanitizeFilename(a.name) !== a.name) throw new StatementError("Unsanitised attachment name");
  if (!Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 0 || a.height < 0 || a.width > 65535 || a.height > 65535) {
    throw new StatementError("Bad image dimensions");
  }
}

function checkFields(f: StatementFields): Uint8Array {
  if (f.tag.length !== 16) throw new StatementError("Room tag must be 16 bytes");
  if (f.author.length !== 32) throw new StatementError("Author key must be 32 bytes");
  if (!Number.isSafeInteger(f.declaredAt) || f.declaredAt < 0) throw new StatementError("Bad timestamp");
  if (f.format !== "text" && f.format !== "markdown") throw new StatementError("Bad format");
  if (f.source !== normalizeSource(f.source) || f.source.includes("\r")) throw new StatementError("Source not in canonical form");
  const source = enc.encode(f.source);
  if (source.length > MAX_SOURCE_BYTES) throw new StatementError("Source too large");
  if (f.attachments.length > MAX_ATTACHMENTS) throw new StatementError("Too many attachments");
  f.attachments.forEach(checkAttachment);
  return source;
}

export function encodeStatement(f: StatementFields): Uint8Array {
  const source = checkFields(f);
  const atts = f.attachments.map((a) => ({ a, mime: enc.encode(a.mime), name: enc.encode(a.name) }));
  const size = HEADER + source.length + 1 + atts.reduce((n, x) => n + 32 + 4 + 1 + x.mime.length + 1 + x.name.length + 4, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out.set(f.tag, 5);
  out.set(f.author, 21);
  view.setBigUint64(53, BigInt(f.declaredAt));
  out[61] = f.format === "text" ? 1 : 2;
  view.setUint32(62, source.length);
  out.set(source, HEADER);
  let o = HEADER + source.length;
  out[o++] = atts.length;
  for (const { a, mime, name } of atts) {
    out.set(a.hash, o);
    view.setUint32(o + 32, a.size);
    o += 36;
    out[o++] = mime.length;
    out.set(mime, o);
    o += mime.length;
    out[o++] = name.length;
    out.set(name, o);
    o += name.length;
    view.setUint16(o, a.width);
    view.setUint16(o + 2, a.height);
    o += 4;
  }
  return out;
}

export function decodeStatement(bytes: Uint8Array): StatementFields {
  const need = (o: number, n: number) => {
    if (o + n > bytes.length) throw new StatementError("Truncated statement");
  };
  need(0, HEADER);
  if (!MAGIC.every((v, i) => bytes[i] === v)) throw new StatementError("Not a paste statement");
  if (bytes[4] !== VERSION) throw new StatementError("Unsupported statement version");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getBigUint64(53);
  if (declared >= 2n ** 53n) throw new StatementError("Bad timestamp");
  const formatByte = bytes[61];
  if (formatByte !== 1 && formatByte !== 2) throw new StatementError("Unknown format");
  const sourceLength = view.getUint32(62);
  if (sourceLength > MAX_SOURCE_BYTES) throw new StatementError("Source too large");
  need(HEADER, sourceLength + 1);
  const text = (o: number, n: number) => {
    try {
      return utf8.decode(bytes.subarray(o, o + n));
    } catch {
      throw new StatementError("Invalid UTF-8");
    }
  };
  const source = text(HEADER, sourceLength);
  let o = HEADER + sourceLength;
  const count = bytes[o++];
  if (count > MAX_ATTACHMENTS) throw new StatementError("Too many attachments");
  const attachments: AttachmentRef[] = [];
  for (let i = 0; i < count; i++) {
    need(o, 37);
    const hash = bytes.slice(o, o + 32);
    const size = view.getUint32(o + 32);
    o += 36;
    const mimeLength = bytes[o++];
    need(o, mimeLength + 1);
    const mime = text(o, mimeLength);
    o += mimeLength;
    const nameLength = bytes[o++];
    need(o, nameLength + 4);
    const name = text(o, nameLength);
    o += nameLength;
    attachments.push({ hash, size, mime, name, width: view.getUint16(o), height: view.getUint16(o + 2) });
    o += 4;
  }
  if (o !== bytes.length) throw new StatementError("Trailing bytes after the statement");
  const fields: StatementFields = {
    tag: bytes.slice(5, 21),
    author: bytes.slice(21, 53),
    declaredAt: Number(declared),
    format: formatByte === 1 ? "text" : "markdown",
    source,
    attachments,
  };
  checkFields(fields);
  return fields;
}

export async function signStatement(statement: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bs(statement)));
}

export async function verifyStatement(statement: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", bs(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bs(signature), bs(statement));
  } catch {
    return false;
  }
}

export async function pasteIdOf(statement: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bs(statement)));
}

/** ITEM plaintext: statement ‖ signature. */
export async function sealItem(statement: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  const signature = await signStatement(statement, privateKey);
  const out = new Uint8Array(statement.length + 64);
  out.set(statement);
  out.set(signature, statement.length);
  return out;
}

export interface OpenedItem {
  id: Uint8Array;
  statement: Uint8Array;
  signature: Uint8Array;
  fields: StatementFields;
}

/** Decodes and verifies an ITEM: encoding, room tag, then signature (REQ-PASTE-013). */
export async function openItem(item: Uint8Array, roomTag: Uint8Array): Promise<OpenedItem> {
  if (item.length < HEADER + 1 + 64) throw new StatementError("Truncated item");
  const statement = item.slice(0, item.length - 64);
  const signature = item.slice(item.length - 64);
  const fields = decodeStatement(statement);
  if (!fields.tag.every((v, i) => v === roomTag[i])) throw new StatementError("Statement of another room");
  if (!(await verifyStatement(statement, signature, fields.author))) throw new StatementError("Invalid signature");
  return { id: await pasteIdOf(statement), statement, signature, fields };
}
