import type { CompressionAlgorithm } from "@/compression/compression";

export const PROTOCOL_VERSION = 0x03;

// Flag constants for frame.flags byte
export const FLAG_TEXT = 0x01;

export interface FrameFlags {
  readonly isText: boolean;
}

export function encodeFlags(flags: FrameFlags): number {
  let bits = 0;
  if (flags.isText) bits |= FLAG_TEXT;
  return bits;
}

export function decodeFlags(flagsByte: number): FrameFlags {
  return {
    isText: (flagsByte & FLAG_TEXT) !== 0,
  };
}

// v3 frame layout:
//   Base header (19 bytes):
//     [0]      version (1B)
//     [1]      flags (1B)
//     [2..5]   metadataHash (4B)
//     [6..7]   sourceBlockCount (uint16 LE)
//     [8..9]   blockSize (uint16 LE) — fountain symbol size
//     [10..13] compressedSize (uint32 LE)
//     [14]     compressionId (1B)
//     [15..18] symbolId (uint32 LE) — always >= 1
//   Metadata section (38 + filenameLen bytes):
//     [19..22] fileSize (uint32 LE)
//     [23..54] sha256 (32B)
//     [55..56] filenameLen (uint16 LE)
//     [57..57+N-1] filename (N bytes UTF-8)
//   Payload:
//     [57+N..] fountain symbol (blockSize bytes)
export const BASE_HEADER_SIZE = 19;
export const METADATA_FIXED_SIZE = 38; // 4 + 32 + 2

/** @deprecated Use BASE_HEADER_SIZE + metadataOverhead instead */
export const HEADER_SIZE = BASE_HEADER_SIZE;

export interface Frame {
  readonly version: number;
  readonly flags: number;
  readonly metadataHash: Uint8Array; // 4 bytes
  readonly sourceBlockCount: number;
  readonly blockSize: number;
  readonly compressedSize: number;
  readonly compressionId: CompressionAlgorithm;
  readonly symbolId: number;
  readonly filename: string;
  readonly fileSize: number;
  readonly sha256: Uint8Array; // 32 bytes
  readonly payload: Uint8Array; // fountain symbol
}

export type ParseResult =
  | { kind: "data"; frame: Frame }
  | { kind: "unknown_version"; version: number }
  | { kind: "error"; message: string };

/**
 * Compute the total frame overhead (everything except the fountain symbol).
 */
export function getFrameOverhead(filenameLen: number): number {
  return BASE_HEADER_SIZE + METADATA_FIXED_SIZE + filenameLen;
}

export function serializeFrame(frame: Frame): Uint8Array {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(frame.filename);
  const overhead = getFrameOverhead(filenameBytes.length);
  const buf = new Uint8Array(overhead + frame.payload.length);
  const view = new DataView(buf.buffer);

  // Base header (19 bytes)
  buf[0] = frame.version;
  buf[1] = frame.flags;
  buf.set(frame.metadataHash, 2);
  view.setUint16(6, frame.sourceBlockCount, true);
  view.setUint16(8, frame.blockSize, true);
  view.setUint32(10, frame.compressedSize, true);
  buf[14] = frame.compressionId;
  view.setUint32(15, frame.symbolId, true);

  // Metadata section
  view.setUint32(19, frame.fileSize, true);
  buf.set(frame.sha256, 23);
  view.setUint16(55, filenameBytes.length, true);
  buf.set(filenameBytes, 57);

  // Payload (fountain symbol)
  buf.set(frame.payload, overhead);

  return buf;
}

export function parseFrame(data: Uint8Array): ParseResult {
  if (data.length < BASE_HEADER_SIZE) {
    return { kind: "error", message: "Frame too short" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];

  if (version !== PROTOCOL_VERSION) {
    return { kind: "unknown_version", version };
  }

  // Base header
  const flags = data[1];
  const metadataHash = data.slice(2, 6);
  const sourceBlockCount = view.getUint16(6, true);
  const blockSize = view.getUint16(8, true);
  const compressedSize = view.getUint32(10, true);
  const compressionId = data[14] as CompressionAlgorithm;
  const symbolId = view.getUint32(15, true);

  // Metadata section
  if (data.length < BASE_HEADER_SIZE + METADATA_FIXED_SIZE) {
    return { kind: "error", message: "Frame too short for metadata" };
  }

  const fileSize = view.getUint32(19, true);
  const sha256 = data.slice(23, 55);
  const filenameLen = view.getUint16(55, true);

  const metaEnd = 57 + filenameLen;
  if (data.length < metaEnd) {
    return { kind: "error", message: "Frame truncated at filename" };
  }

  const filenameBytes = data.slice(57, metaEnd);
  const filename = new TextDecoder().decode(filenameBytes);

  const payload = data.slice(metaEnd);

  const frame: Frame = {
    version: PROTOCOL_VERSION,
    flags,
    metadataHash,
    sourceBlockCount,
    blockSize,
    compressedSize,
    compressionId,
    symbolId,
    filename,
    fileSize,
    sha256,
    payload,
  };

  return { kind: "data", frame };
}
