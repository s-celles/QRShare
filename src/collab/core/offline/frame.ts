/**
 * Offline sync frames: the unit exchanged between devices through animated QR
 * codes (or any other channel). Binary, versioned, size-limited before
 * decoding, optionally compressed and signed.
 *
 *   offset  size  field
 *   0       4     magic "QSYN"
 *   4       1     format version (1)
 *   5       1     type (HELLO, STATE_VECTOR, UPDATE, BLOB_REQUEST, BLOB)
 *   6       1     flags: bit 0 compressed, bit 1 signed
 *   7       1     reserved (0)
 *   8       16    document id (UUID)
 *   24      16    sender id (first 16 bytes of SHA-256 of its public key)
 *   40      4     payload length, big-endian
 *   44      n     payload
 *   44+n    64    Ed25519 signature of bytes [0, 44+n), when signed
 */

export const MAGIC = [0x51, 0x53, 0x59, 0x4e]; // "QSYN"
export const FORMAT_VERSION = 1;
export const HEADER_BYTES = 44;
export const SIGNATURE_BYTES = 64;
/** Default limit of a frame, and of its payload once decompressed. */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export enum FrameType {
  HELLO = 1,
  STATE_VECTOR = 2,
  UPDATE = 3,
  BLOB_REQUEST = 4,
  BLOB = 5,
}

const FLAG_COMPRESSED = 1;
const FLAG_SIGNED = 2;

export interface Frame {
  type: FrameType;
  /** Document id, a UUID string. */
  docId: string;
  /** 16 bytes, see `peerId`. */
  senderId: Uint8Array;
  /** The payload, already decompressed. */
  payload: Uint8Array;
}

export type FrameErrorCode = "format" | "version" | "truncated" | "tooLarge" | "type" | "signature" | "untrusted" | "invalid";

export class FrameError extends Error {
  constructor(
    readonly code: FrameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FrameError";
  }
}

// --- UUIDs ------------------------------------------------------------------

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new FrameError("invalid", `Not a UUID: ${uuid}`);
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

export function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// --- compression --------------------------------------------------------------

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new FrameError("tooLarge", `Payload larger than ${limit} bytes once decompressed`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export const canCompress = (): boolean => typeof CompressionStream === "function";

export const deflate = (data: Uint8Array): Promise<Uint8Array> => pipe(data, new CompressionStream("deflate-raw"), Number.MAX_SAFE_INTEGER);

export async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  try {
    return await pipe(data, new DecompressionStream("deflate-raw"), limit);
  } catch (err) {
    if (err instanceof FrameError) throw err;
    throw new FrameError("format", "The payload could not be decompressed");
  }
}

// --- encoding --------------------------------------------------------------------

export interface EncodeOptions {
  /** Compress the payload when it gets smaller (default: when available). */
  compress?: boolean;
  /** Sign with this Ed25519 private key. */
  signWith?: CryptoKey;
}

export async function encodeFrame(frame: Frame, opts: EncodeOptions = {}): Promise<Uint8Array> {
  if (frame.senderId.length !== 16) throw new FrameError("invalid", "The sender id must be 16 bytes");
  let payload = frame.payload;
  let flags = 0;
  if ((opts.compress ?? canCompress()) && payload.length > 64) {
    const packed = await deflate(payload);
    if (packed.length < payload.length) {
      payload = packed;
      flags |= FLAG_COMPRESSED;
    }
  }
  if (opts.signWith) flags |= FLAG_SIGNED;
  const body = new Uint8Array(HEADER_BYTES + payload.length);
  body.set(MAGIC, 0);
  body[4] = FORMAT_VERSION;
  body[5] = frame.type;
  body[6] = flags;
  body.set(uuidToBytes(frame.docId), 8);
  body.set(frame.senderId, 24);
  new DataView(body.buffer).setUint32(40, payload.length);
  body.set(payload, HEADER_BYTES);
  if (!opts.signWith) return body;
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", opts.signWith, body as BufferSource));
  const out = new Uint8Array(body.length + SIGNATURE_BYTES);
  out.set(body);
  out.set(signature, body.length);
  return out;
}

export interface DecodedFrame extends Frame {
  compressed: boolean;
  /** The bytes covered by the signature. */
  signedBytes: Uint8Array;
  signature?: Uint8Array;
}

export interface DecodeOptions {
  /** Largest accepted frame, and decompressed payload (default 4 MiB). */
  maxBytes?: number;
}

/**
 * Check and read a frame. Nothing is decompressed or parsed before the
 * magic, version, type and lengths are checked.
 */
export async function decodeFrame(bytes: Uint8Array, opts: DecodeOptions = {}): Promise<DecodedFrame> {
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (bytes.length > max + HEADER_BYTES + SIGNATURE_BYTES) throw new FrameError("tooLarge", `Frame larger than ${max} bytes`);
  if (bytes.length < HEADER_BYTES) throw new FrameError("truncated", "Frame shorter than its header");
  if (MAGIC.some((b, i) => bytes[i] !== b)) throw new FrameError("format", "Not an offline sync frame");
  if (bytes[4] !== FORMAT_VERSION) throw new FrameError("version", `Unknown frame format version ${bytes[4]}`);
  const type = bytes[5]!;
  if (!(type in FrameType) || typeof FrameType[type] !== "string") throw new FrameError("type", `Unknown frame type ${type}`);
  const flags = bytes[6]!;
  if (flags & ~(FLAG_COMPRESSED | FLAG_SIGNED) || bytes[7] !== 0) throw new FrameError("format", "Unknown frame flags");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40);
  if (length > max) throw new FrameError("tooLarge", `Payload larger than ${max} bytes`);
  const signed = (flags & FLAG_SIGNED) !== 0;
  const expected = HEADER_BYTES + length + (signed ? SIGNATURE_BYTES : 0);
  if (bytes.length < expected) throw new FrameError("truncated", "Frame shorter than announced");
  if (bytes.length > expected) throw new FrameError("format", "Unexpected bytes after the frame");
  const raw = bytes.slice(HEADER_BYTES, HEADER_BYTES + length);
  const compressed = (flags & FLAG_COMPRESSED) !== 0;
  const payload = compressed ? await inflate(raw, max) : raw;
  return {
    type: type as FrameType,
    docId: bytesToUuid(bytes.slice(8, 24)),
    senderId: bytes.slice(24, 40),
    payload,
    compressed,
    signedBytes: bytes.slice(0, HEADER_BYTES + length),
    ...(signed ? { signature: bytes.slice(HEADER_BYTES + length) } : {}),
  };
}
