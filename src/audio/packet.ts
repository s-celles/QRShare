/**
 * Audio packet layer (REQ-AUD-070..074, REQ-AUD-078).
 *
 * On air, a packet is a header codeword followed by a body codeword:
 *
 *   header (RS(7,3)): [bodyLen u8][version<<4 | profileIdx][bodyLen ^ 0xA5][4 B parity]
 *   body   (RS(bodyLen + parity, bodyLen)):
 *     data:     [0x10][metadataHash 4B][symbolId u16 LE][symbol][CRC32 LE 4B][parity]
 *     metadata: [0x11][serializeFrame({ symbolId: 0, payload: empty })][CRC32 LE 4B][parity]
 *
 * The CRC32 covers every body byte before it; a packet is accepted only when the
 * RS decoding succeeds and the CRC matches.
 */

import { crc32 } from "./crc32";
import { rsDecode, rsEncode } from "./reed-solomon";
import {
  DATA_BODY_OVERHEAD,
  HEADER_CODEWORD_BYTES,
  HEADER_DATA_BYTES,
  HEADER_PARITY,
  METADATA_BODY_OVERHEAD,
  profileByIndex,
  profileIndex,
  type AudioProfile,
} from "./profiles";
import { parseFrame, serializeFrame, PROTOCOL_VERSION, type Frame } from "@/protocol/frame";

export const AUDIO_PACKET_VERSION = 0x1;
export const PACKET_TYPE_DATA = 0x0;
export const PACKET_TYPE_METADATA = 0x1;
/** Metadata encrypted with the transfer password (see `sealed.ts`). */
export const PACKET_TYPE_SEALED_METADATA = 0x2;
/**
 * Sealed metadata body: type (1) + session id (4) + salt (16) + IV (12) +
 * encrypted v3 frame header (57 + filename) + GCM tag (16) + CRC32 (4).
 */
export const SEALED_METADATA_OVERHEAD = 1 + 4 + 16 + 12 + 57 + 16 + 4;
/** Audio session packet (see `link/`): clear header + payload. */
export const PACKET_TYPE_LINK = 0x3;
/** Link header: type (1) + room id (4) + sender id (4) + kind (1) + counter (4). */
export const LINK_HEADER_BYTES = 14;
const HEADER_CHECK_XOR = 0xa5;
const MIN_BODY_LEN = DATA_BODY_OVERHEAD + 1;
const MAX_CODEWORD = 255;

export type AudioPacket =
  | { kind: "data"; metadataHash: Uint8Array; symbolId: number; symbol: Uint8Array }
  | { kind: "metadata"; frame: Frame }
  | {
      kind: "sealed-metadata";
      metadataHash: Uint8Array;
      salt: Uint8Array;
      iv: Uint8Array;
      /** Encrypted v3 frame header with its GCM tag. */
      ciphertext: Uint8Array;
    }
  | {
      kind: "link";
      /** The 14 clear header bytes (associated data of the encryption). */
      header: Uint8Array;
      roomId: Uint8Array;
      from: number;
      linkKind: number;
      counter: number;
      payload: Uint8Array;
    };

export interface LinkHeaderFields {
  readonly roomId: Uint8Array;
  readonly from: number;
  readonly kind: number;
  readonly counter: number;
}

export type RejectReason = "header_rs" | "body_rs" | "crc" | "version" | "malformed";

export type PacketDecodeResult =
  | { kind: "ok"; packet: AudioPacket; correctedBytes: number }
  | { kind: "rejected"; reason: RejectReason };

export type HeaderDecodeResult =
  | { ok: true; bodyLen: number; profile: AudioProfile; correctedBytes: number }
  | { ok: false };

function withCrc(content: Uint8Array): Uint8Array {
  const body = new Uint8Array(content.length + 4);
  body.set(content);
  new DataView(body.buffer).setUint32(content.length, crc32(content), true);
  return body;
}

/** Body of a data packet (CRC included, parity excluded). `symbolId` is 1..65535. */
export function encodeDataBody(metadataHash: Uint8Array, symbolId: number, symbol: Uint8Array): Uint8Array {
  if (!Number.isInteger(symbolId) || symbolId < 1 || symbolId > 0xffff) {
    throw new Error(`Audio symbolId out of range: ${symbolId}`);
  }
  if (metadataHash.length !== 4) throw new Error("metadataHash must be 4 bytes");
  const content = new Uint8Array(DATA_BODY_OVERHEAD - 4 + symbol.length);
  content[0] = (AUDIO_PACKET_VERSION << 4) | PACKET_TYPE_DATA;
  content.set(metadataHash, 1);
  content[5] = symbolId & 0xff;
  content[6] = symbolId >>> 8;
  content.set(symbol, 7);
  return withCrc(content);
}

/** Largest UTF-8 filename (bytes) that keeps a metadata body codeword ≤ 255 bytes. */
export function maxFilenameBytes(profile: AudioProfile, sealed = false): number {
  return MAX_CODEWORD - profile.parity - (sealed ? SEALED_METADATA_OVERHEAD : METADATA_BODY_OVERHEAD);
}

/** Largest link payload that fits one packet of `profile`. */
export function maxLinkPayload(profile: AudioProfile): number {
  return MAX_CODEWORD - profile.parity - LINK_HEADER_BYTES - 4;
}

/** The clear 14-byte link header (also the AAD of its encrypted payload). */
export function encodeLinkHeader(h: LinkHeaderFields): Uint8Array {
  if (h.roomId.length !== 4) throw new Error("room id must be 4 bytes");
  const out = new Uint8Array(LINK_HEADER_BYTES);
  const v = new DataView(out.buffer);
  out[0] = (AUDIO_PACKET_VERSION << 4) | PACKET_TYPE_LINK;
  out.set(h.roomId, 1);
  v.setUint32(5, h.from >>> 0);
  out[9] = h.kind;
  v.setUint32(10, h.counter >>> 0);
  return out;
}

/** Body of an audio session packet: header ‖ payload ‖ CRC32. */
export function encodeLinkBody(h: LinkHeaderFields, payload: Uint8Array): Uint8Array {
  const header = encodeLinkHeader(h);
  const content = new Uint8Array(header.length + payload.length);
  content.set(header);
  content.set(payload, header.length);
  return withCrc(content);
}

/** Body of a sealed metadata packet (the frame is encrypted by the caller). */
export function encodeSealedMetadataBody(
  sessionId: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  if (sessionId.length !== 4 || salt.length !== 16 || iv.length !== 12) throw new Error("Invalid sealed metadata fields");
  const content = new Uint8Array(1 + 4 + 16 + 12 + ciphertext.length);
  content[0] = (AUDIO_PACKET_VERSION << 4) | PACKET_TYPE_SEALED_METADATA;
  content.set(sessionId, 1);
  content.set(salt, 5);
  content.set(iv, 21);
  content.set(ciphertext, 33);
  return withCrc(content);
}

const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

/** Takes whole code points from the start of `s` while staying within `maxBytes` UTF-8 bytes. */
function takeBytes(s: string, maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const cp of s) {
    const len = utf8Len(cp);
    if (used + len > maxBytes) break;
    out += cp;
    used += len;
  }
  return out;
}

/**
 * Truncates a filename to at most `maxBytes` UTF-8 bytes, cutting the stem on a
 * code-point boundary and keeping the last extension (REQ-AUD-073).
 */
export function truncateFilename(name: string, maxBytes: number): string {
  if (utf8Len(name) <= maxBytes) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extLen = utf8Len(ext);
  if (ext && extLen < maxBytes) return takeBytes(stem, maxBytes - extLen) + ext;
  return takeBytes(name, maxBytes);
}

/** Body of a metadata packet: a v3 frame with `symbolId = 0` and no payload. */
export function encodeMetadataBody(
  meta: Omit<Frame, "symbolId" | "payload" | "version">,
  profile: AudioProfile,
): Uint8Array {
  const filename = truncateFilename(meta.filename, maxFilenameBytes(profile));
  const frame = serializeFrame({
    ...meta,
    filename,
    version: PROTOCOL_VERSION,
    symbolId: 0,
    payload: new Uint8Array(0),
  });
  const content = new Uint8Array(1 + frame.length);
  content[0] = (AUDIO_PACKET_VERSION << 4) | PACKET_TYPE_METADATA;
  content.set(frame, 1);
  return withCrc(content);
}

/** Header codeword + body codeword, ready for the modulator. */
export function encodeOnAir(body: Uint8Array, profile: AudioProfile): Uint8Array {
  if (body.length < MIN_BODY_LEN || body.length + profile.parity > MAX_CODEWORD) {
    throw new Error(`Audio body length ${body.length} out of range for profile ${profile.id}`);
  }
  const header = new Uint8Array(HEADER_DATA_BYTES);
  header[0] = body.length;
  header[1] = (AUDIO_PACKET_VERSION << 4) | profileIndex(profile.id);
  header[2] = body.length ^ HEADER_CHECK_XOR;
  const headerCw = rsEncode(header, HEADER_PARITY);
  const bodyCw = rsEncode(body, profile.parity);
  const out = new Uint8Array(headerCw.length + bodyCw.length);
  out.set(headerCw);
  out.set(bodyCw, headerCw.length);
  return out;
}

/** Decodes the 7-byte header codeword. */
export function decodeHeader(codeword: Uint8Array, erasures: readonly number[] = []): HeaderDecodeResult {
  if (codeword.length !== HEADER_CODEWORD_BYTES) return { ok: false };
  const res = rsDecode(codeword, HEADER_PARITY, erasures);
  if (!res.ok) return { ok: false };
  const [bodyLen, verProfile, check] = res.data;
  if (verProfile >> 4 !== AUDIO_PACKET_VERSION) return { ok: false };
  if ((bodyLen ^ HEADER_CHECK_XOR) !== check) return { ok: false };
  const profile = profileByIndex(verProfile & 0x0f);
  if (!profile) return { ok: false };
  if (bodyLen < MIN_BODY_LEN || bodyLen + profile.parity > MAX_CODEWORD) return { ok: false };
  return { ok: true, bodyLen, profile, correctedBytes: res.corrected };
}

/** RS-decodes a body codeword (with erasures), then checks the CRC and parses it. */
export function decodeBody(
  codeword: Uint8Array,
  parity: number,
  erasures: readonly number[] = [],
): PacketDecodeResult {
  const res = rsDecode(codeword, parity, erasures);
  if (!res.ok) return { kind: "rejected", reason: "body_rs" };
  const parsed = parseAudioPacket(res.data);
  if (parsed.kind === "ok") return { ...parsed, correctedBytes: res.corrected };
  return parsed;
}

/** Parses a body (CRC included). */
export function parseAudioPacket(body: Uint8Array): PacketDecodeResult {
  if (body.length < 5) return { kind: "rejected", reason: "malformed" };
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const crc = view.getUint32(body.length - 4, true);
  const content = body.subarray(0, body.length - 4);
  if (crc32(content) !== crc) return { kind: "rejected", reason: "crc" };

  const version = content[0] >> 4;
  if (version !== AUDIO_PACKET_VERSION) {
    console.warn(`[audio] Ignoring packet with unknown version ${version}`);
    return { kind: "rejected", reason: "version" };
  }
  const type = content[0] & 0x0f;
  if (type === PACKET_TYPE_DATA) {
    if (content.length < DATA_BODY_OVERHEAD - 4 + 1) return { kind: "rejected", reason: "malformed" };
    const symbolId = content[5] | (content[6] << 8);
    if (symbolId === 0) return { kind: "rejected", reason: "malformed" };
    return {
      kind: "ok",
      correctedBytes: 0,
      packet: {
        kind: "data",
        metadataHash: content.slice(1, 5),
        symbolId,
        symbol: content.slice(7),
      },
    };
  }
  if (type === PACKET_TYPE_LINK) {
    if (content.length < LINK_HEADER_BYTES) return { kind: "rejected", reason: "malformed" };
    const v = new DataView(content.buffer, content.byteOffset, content.byteLength);
    return {
      kind: "ok",
      correctedBytes: 0,
      packet: {
        kind: "link",
        header: content.slice(0, LINK_HEADER_BYTES),
        roomId: content.slice(1, 5),
        from: v.getUint32(5),
        linkKind: content[9],
        counter: v.getUint32(10),
        payload: content.slice(LINK_HEADER_BYTES),
      },
    };
  }
  if (type === PACKET_TYPE_SEALED_METADATA) {
    if (content.length < SEALED_METADATA_OVERHEAD - 4) return { kind: "rejected", reason: "malformed" };
    return {
      kind: "ok",
      correctedBytes: 0,
      packet: {
        kind: "sealed-metadata",
        metadataHash: content.slice(1, 5),
        salt: content.slice(5, 21),
        iv: content.slice(21, 33),
        ciphertext: content.slice(33),
      },
    };
  }
  if (type === PACKET_TYPE_METADATA) {
    const parsed = parseFrame(content.subarray(1));
    if (parsed.kind !== "data" || parsed.frame.symbolId !== 0 || parsed.frame.payload.length !== 0) {
      return { kind: "rejected", reason: "malformed" };
    }
    return { kind: "ok", correctedBytes: 0, packet: { kind: "metadata", frame: parsed.frame } };
  }
  return { kind: "rejected", reason: "malformed" };
}

/** Byte-level loopback: decodes `encodeOnAir` output without the modem (tests, tools). */
export function decodeOnAir(bytes: Uint8Array): PacketDecodeResult {
  const hdr = decodeHeader(bytes.subarray(0, HEADER_CODEWORD_BYTES));
  if (!hdr.ok) return { kind: "rejected", reason: "header_rs" };
  const end = HEADER_CODEWORD_BYTES + hdr.bodyLen + hdr.profile.parity;
  if (bytes.length < end) return { kind: "rejected", reason: "malformed" };
  return decodeBody(bytes.subarray(HEADER_CODEWORD_BYTES, end), hdr.profile.parity);
}

