import type { CompressionAlgorithm } from "@/compression/compression";

export const PROTOCOL_VERSION = 0x02;
// Header layout (19 bytes):
//   [0]     version (1B)
//   [1]     flags (1B)
//   [2..5]  metadataHash (4B)
//   [6..7]  sourceBlockCount (uint16 LE)
//   [8..9]  blockSize (uint16 LE)
//   [10..13] compressedSize (uint32 LE)
//   [14]    compressionId (1B)
//   [15..18] symbolId (uint32 LE)
export const HEADER_SIZE = 19;

export interface Frame {
  readonly version: number;
  readonly flags: number;
  readonly metadataHash: Uint8Array; // 4 bytes
  readonly sourceBlockCount: number;
  readonly blockSize: number;
  readonly compressedSize: number;
  readonly compressionId: CompressionAlgorithm;
  readonly symbolId: number;
  readonly payload: Uint8Array;
}

export interface MetadataFrame extends Frame {
  readonly symbolId: 0;
  readonly filename: string;
  readonly fileSize: number;
  readonly sha256: Uint8Array; // 32 bytes
}

export type ParseResult =
  | { kind: "data"; frame: Frame }
  | { kind: "metadata"; frame: MetadataFrame }
  | { kind: "unknown_version"; version: number }
  | { kind: "error"; message: string };

export function serializeFrame(frame: Frame): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE + frame.payload.length);
  const view = new DataView(buf.buffer);

  buf[0] = frame.version;
  buf[1] = frame.flags;
  buf.set(frame.metadataHash, 2);
  view.setUint16(6, frame.sourceBlockCount, true);
  view.setUint16(8, frame.blockSize, true);
  view.setUint32(10, frame.compressedSize, true);
  buf[14] = frame.compressionId;
  view.setUint32(15, frame.symbolId, true);
  buf.set(frame.payload, HEADER_SIZE);

  return buf;
}

/**
 * Serialize a metadata frame. If targetPayloadSize is provided, the payload
 * is zero-padded to that size so the resulting QR code has the same visual
 * density as data frames.
 */
export function serializeMetadataFrame(
  frame: MetadataFrame,
  targetPayloadSize?: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(frame.filename);
  // Metadata payload: filenameLen(2B) + filename + fileSize(4B) + sha256(32B)
  const metaContentSize = 2 + filenameBytes.length + 4 + 32;
  const metaPayloadSize =
    targetPayloadSize && targetPayloadSize > metaContentSize
      ? targetPayloadSize
      : metaContentSize;
  const metaPayload = new Uint8Array(metaPayloadSize); // zero-filled
  const metaView = new DataView(metaPayload.buffer);

  let offset = 0;
  metaView.setUint16(offset, filenameBytes.length, true);
  offset += 2;
  metaPayload.set(filenameBytes, offset);
  offset += filenameBytes.length;
  metaView.setUint32(offset, frame.fileSize, true);
  offset += 4;
  metaPayload.set(frame.sha256, offset);

  const headerFrame: Frame = {
    version: frame.version,
    flags: frame.flags,
    metadataHash: frame.metadataHash,
    sourceBlockCount: frame.sourceBlockCount,
    blockSize: frame.blockSize,
    compressedSize: frame.compressedSize,
    compressionId: frame.compressionId,
    symbolId: 0,
    payload: metaPayload,
  };

  return serializeFrame(headerFrame);
}

export function parseFrame(data: Uint8Array): ParseResult {
  if (data.length < HEADER_SIZE) {
    return { kind: "error", message: "Frame too short" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];

  if (version !== PROTOCOL_VERSION) {
    return { kind: "unknown_version", version };
  }

  const flags = data[1];
  const metadataHash = data.slice(2, 6);
  const sourceBlockCount = view.getUint16(6, true);
  const blockSize = view.getUint16(8, true);
  const compressedSize = view.getUint32(10, true);
  const compressionId = data[14] as CompressionAlgorithm;
  const symbolId = view.getUint32(15, true);
  const payload = data.slice(HEADER_SIZE);

  const frame: Frame = {
    version: PROTOCOL_VERSION,
    flags,
    metadataHash,
    sourceBlockCount,
    blockSize,
    compressedSize,
    compressionId,
    symbolId,
    payload,
  };

  if (symbolId === 0 && payload.length > 0) {
    return parseMetadataPayload(frame, payload);
  }

  return { kind: "data", frame };
}

function parseMetadataPayload(
  baseFrame: Frame,
  payload: Uint8Array,
): ParseResult {
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );

  let offset = 0;

  if (payload.length < 2) {
    return { kind: "error", message: "Metadata payload too short" };
  }

  const filenameLen = view.getUint16(offset, true);
  offset += 2;

  if (payload.length < offset + filenameLen + 4 + 32) {
    return { kind: "error", message: "Metadata payload truncated" };
  }

  const filenameBytes = payload.slice(offset, offset + filenameLen);
  const filename = new TextDecoder().decode(filenameBytes);
  offset += filenameLen;

  const fileSize = view.getUint32(offset, true);
  offset += 4;

  const sha256 = payload.slice(offset, offset + 32);

  const metadataFrame: MetadataFrame = {
    version: PROTOCOL_VERSION,
    flags: baseFrame.flags,
    metadataHash: baseFrame.metadataHash,
    sourceBlockCount: baseFrame.sourceBlockCount,
    blockSize: baseFrame.blockSize,
    compressedSize: baseFrame.compressedSize,
    compressionId: baseFrame.compressionId,
    symbolId: 0,
    payload: baseFrame.payload,
    filename,
    fileSize,
    sha256,
  };

  return { kind: "metadata", frame: metadataFrame };
}
