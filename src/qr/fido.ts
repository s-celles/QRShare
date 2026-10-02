/**
 * FIDO hybrid sign-in QR codes ("FIDO:/" followed by digits), shown by a computer
 * that asks a phone to sign in or register with a passkey (CTAP 2.2, hybrid
 * transport, §11.5). A web page cannot act as the phone's authenticator, so
 * QRShare only recognises and explains these codes (REQ-STRUCT-007..009).
 *
 * Format: the bytes of a CBOR map are written in decimal, 7 bytes (read as a
 * little-endian integer) per 17 digits, the last chunk with fewer digits.
 */

const PREFIX = /^FIDO:\//i;
const FULL_CHUNK_BYTES = 7;
const FULL_CHUNK_DIGITS = 17;
/** Digits of a final chunk of 0 to 6 bytes. */
const PARTIAL_CHUNK_DIGITS = [0, 3, 5, 8, 10, 13, 15];
/** Upper bound on the decoded size, to reject absurd input cheaply. */
const MAX_BYTES = 512;

export type FidoRequest = "sign-in" | "register" | "unknown";

export interface FidoHybridCode {
  /** Compressed P-256 public key of the computer (33 bytes). */
  publicKey: Uint8Array;
  /** Secret shared with the phone (16 bytes). */
  secret: Uint8Array;
  /** Number of tunnel server domains the phone may use. */
  tunnelServerDomains: number;
  /** When the computer created the code, if it said so. */
  createdAt?: Date;
  /** Whether the computer supports state-assisted transactions (linking). */
  stateAssisted?: boolean;
  /** What the computer asks for: sign in with a passkey, or create one. */
  request: FidoRequest;
}

export function isFidoUri(text: string): boolean {
  return PREFIX.test(text.trim());
}

/** Decodes the digits after "FIDO:/" into bytes, or returns null if they are malformed. */
export function decodeFidoDigits(digits: string): Uint8Array | null {
  if (!/^\d*$/.test(digits)) return null;
  const fullChunks = Math.floor(digits.length / FULL_CHUNK_DIGITS);
  const rest = digits.length - fullChunks * FULL_CHUNK_DIGITS;
  const restBytes = PARTIAL_CHUNK_DIGITS.indexOf(rest);
  if (restBytes < 0) return null;
  const length = fullChunks * FULL_CHUNK_BYTES + restBytes;
  if (length > MAX_BYTES) return null;

  const out = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < digits.length; ) {
    const size = i + FULL_CHUNK_DIGITS <= digits.length ? FULL_CHUNK_DIGITS : rest;
    const bytes = size === FULL_CHUNK_DIGITS ? FULL_CHUNK_BYTES : restBytes;
    let value = BigInt(digits.slice(i, i + size));
    if (value >> BigInt(8 * bytes) !== 0n) return null;
    for (let b = 0; b < bytes; b++) {
      out[offset++] = Number(value & 0xffn);
      value >>= 8n;
    }
    i += size;
  }
  return out;
}

/** Encodes bytes as FIDO digits (the inverse of decodeFidoDigits). */
export function encodeFidoDigits(bytes: Uint8Array): string {
  let digits = "";
  for (let i = 0; i < bytes.length; i += FULL_CHUNK_BYTES) {
    const chunk = bytes.subarray(i, i + FULL_CHUNK_BYTES);
    let value = 0n;
    for (let b = chunk.length - 1; b >= 0; b--) value = (value << 8n) | BigInt(chunk[b]);
    const width = chunk.length === FULL_CHUNK_BYTES ? FULL_CHUNK_DIGITS : PARTIAL_CHUNK_DIGITS[chunk.length];
    digits += value.toString().padStart(width, "0");
  }
  return digits;
}

type CborValue = number | bigint | boolean | null | string | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

/** A minimal CBOR decoder for the definite-length items a FIDO code uses. */
function decodeCbor(data: Uint8Array): CborValue {
  let pos = 0;
  const byte = (): number => {
    if (pos >= data.length) throw new Error("truncated");
    return data[pos++];
  };
  const argument = (info: number): number => {
    if (info < 24) return info;
    let size: number;
    if (info === 24) size = 1;
    else if (info === 25) size = 2;
    else if (info === 26) size = 4;
    else if (info === 27) size = 8;
    else throw new Error("unsupported length");
    let value = 0n;
    for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(byte());
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("too large");
    return Number(value);
  };
  const item = (depth: number): CborValue => {
    if (depth > 8) throw new Error("too deep");
    const head = byte();
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case 0:
        return argument(info);
      case 1:
        return -1 - argument(info);
      case 2: {
        const n = argument(info);
        if (pos + n > data.length) throw new Error("truncated");
        return data.slice(pos, (pos += n));
      }
      case 3: {
        const n = argument(info);
        if (pos + n > data.length) throw new Error("truncated");
        return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(pos, (pos += n)));
      }
      case 4: {
        const n = argument(info);
        if (n > data.length) throw new Error("truncated");
        return Array.from({ length: n }, () => item(depth + 1));
      }
      case 5: {
        const n = argument(info);
        if (n > data.length) throw new Error("truncated");
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) map.set(item(depth + 1), item(depth + 1));
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error("unsupported simple value");
      default:
        throw new Error("unsupported type");
    }
  };
  const value = item(0);
  if (pos !== data.length) throw new Error("trailing data");
  return value;
}

/** Parses a "FIDO:/" code, or returns null if it is not a well-formed hybrid code. */
export function parseFidoUri(text: string): FidoHybridCode | null {
  const trimmed = text.trim();
  if (!isFidoUri(trimmed)) return null;
  const bytes = decodeFidoDigits(trimmed.replace(PREFIX, ""));
  if (!bytes || bytes.length === 0) return null;

  let map: CborValue;
  try {
    map = decodeCbor(bytes);
  } catch {
    return null;
  }
  if (!(map instanceof Map)) return null;

  const publicKey = map.get(0);
  const secret = map.get(1);
  const domains = map.get(2);
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 33) return null;
  if (!(secret instanceof Uint8Array) || secret.length !== 16) return null;
  if (typeof domains !== "number" || domains < 0) return null;

  const time = map.get(3);
  const state = map.get(4);
  const hint = map.get(5);
  return {
    publicKey,
    secret,
    tunnelServerDomains: domains,
    ...(typeof time === "number" && time > 0 ? { createdAt: new Date(time * 1000) } : {}),
    ...(typeof state === "boolean" ? { stateAssisted: state } : {}),
    request: hint === "ga" ? "sign-in" : hint === "mc" ? "register" : "unknown",
  };
}
