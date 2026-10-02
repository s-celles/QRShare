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
export declare const MAGIC: number[];
export declare const FORMAT_VERSION = 1;
export declare const HEADER_BYTES = 44;
export declare const SIGNATURE_BYTES = 64;
/** Default limit of a frame, and of its payload once decompressed. */
export declare const DEFAULT_MAX_BYTES: number;
export declare enum FrameType {
    HELLO = 1,
    STATE_VECTOR = 2,
    UPDATE = 3,
    BLOB_REQUEST = 4,
    BLOB = 5
}
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
export declare class FrameError extends Error {
    readonly code: FrameErrorCode;
    constructor(code: FrameErrorCode, message: string);
}
export declare function uuidToBytes(uuid: string): Uint8Array;
export declare function bytesToUuid(bytes: Uint8Array): string;
export declare const toHex: (bytes: Uint8Array) => string;
export declare const canCompress: () => boolean;
export declare const deflate: (data: Uint8Array) => Promise<Uint8Array>;
export declare function inflate(data: Uint8Array, limit: number): Promise<Uint8Array>;
export interface EncodeOptions {
    /** Compress the payload when it gets smaller (default: when available). */
    compress?: boolean;
    /** Sign with this Ed25519 private key. */
    signWith?: CryptoKey;
}
export declare function encodeFrame(frame: Frame, opts?: EncodeOptions): Promise<Uint8Array>;
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
export declare function decodeFrame(bytes: Uint8Array, opts?: DecodeOptions): Promise<DecodedFrame>;
/** Default limit of frames carried by one transfer. */
export declare const DEFAULT_MAX_FRAMES = 8;
/** Frames sent together (one QR transfer): they are self-delimiting, so simply concatenated. */
export declare function joinFrames(frames: Uint8Array[]): Uint8Array;
/**
 * Split a transfer into its frames, checking each header's magic, version
 * and announced length (not the content: `decodeFrame` does that).
 */
export declare function splitFrames(bytes: Uint8Array, opts?: DecodeOptions & {
    maxFrames?: number;
}): Uint8Array[];
