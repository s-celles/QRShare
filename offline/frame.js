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
export var FrameType;
(function (FrameType) {
    FrameType[FrameType["HELLO"] = 1] = "HELLO";
    FrameType[FrameType["STATE_VECTOR"] = 2] = "STATE_VECTOR";
    FrameType[FrameType["UPDATE"] = 3] = "UPDATE";
    FrameType[FrameType["BLOB_REQUEST"] = 4] = "BLOB_REQUEST";
    FrameType[FrameType["BLOB"] = 5] = "BLOB";
})(FrameType || (FrameType = {}));
const FLAG_COMPRESSED = 1;
const FLAG_SIGNED = 2;
export class FrameError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "FrameError";
    }
}
// --- UUIDs ------------------------------------------------------------------
export function uuidToBytes(uuid) {
    const hex = uuid.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(hex))
        throw new FrameError("invalid", `Not a UUID: ${uuid}`);
    return Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
}
export function bytesToUuid(bytes) {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
// --- compression --------------------------------------------------------------
async function pipe(data, stream, limit) {
    const reader = new Blob([data]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
export const canCompress = () => typeof CompressionStream === "function";
export const deflate = (data) => pipe(data, new CompressionStream("deflate-raw"), Number.MAX_SAFE_INTEGER);
export async function inflate(data, limit) {
    try {
        return await pipe(data, new DecompressionStream("deflate-raw"), limit);
    }
    catch (err) {
        if (err instanceof FrameError)
            throw err;
        throw new FrameError("format", "The payload could not be decompressed");
    }
}
export async function encodeFrame(frame, opts = {}) {
    if (frame.senderId.length !== 16)
        throw new FrameError("invalid", "The sender id must be 16 bytes");
    let payload = frame.payload;
    let flags = 0;
    if ((opts.compress ?? canCompress()) && payload.length > 64) {
        const packed = await deflate(payload);
        if (packed.length < payload.length) {
            payload = packed;
            flags |= FLAG_COMPRESSED;
        }
    }
    if (opts.signWith)
        flags |= FLAG_SIGNED;
    const body = new Uint8Array(HEADER_BYTES + payload.length);
    body.set(MAGIC, 0);
    body[4] = FORMAT_VERSION;
    body[5] = frame.type;
    body[6] = flags;
    body.set(uuidToBytes(frame.docId), 8);
    body.set(frame.senderId, 24);
    new DataView(body.buffer).setUint32(40, payload.length);
    body.set(payload, HEADER_BYTES);
    if (!opts.signWith)
        return body;
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", opts.signWith, body));
    const out = new Uint8Array(body.length + SIGNATURE_BYTES);
    out.set(body);
    out.set(signature, body.length);
    return out;
}
/**
 * Check and read a frame. Nothing is decompressed or parsed before the
 * magic, version, type and lengths are checked.
 */
export async function decodeFrame(bytes, opts = {}) {
    const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    if (bytes.length > max + HEADER_BYTES + SIGNATURE_BYTES)
        throw new FrameError("tooLarge", `Frame larger than ${max} bytes`);
    if (bytes.length < HEADER_BYTES)
        throw new FrameError("truncated", "Frame shorter than its header");
    if (MAGIC.some((b, i) => bytes[i] !== b))
        throw new FrameError("format", "Not an offline sync frame");
    if (bytes[4] !== FORMAT_VERSION)
        throw new FrameError("version", `Unknown frame format version ${bytes[4]}`);
    const type = bytes[5];
    if (!(type in FrameType) || typeof FrameType[type] !== "string")
        throw new FrameError("type", `Unknown frame type ${type}`);
    const flags = bytes[6];
    if (flags & ~(FLAG_COMPRESSED | FLAG_SIGNED) || bytes[7] !== 0)
        throw new FrameError("format", "Unknown frame flags");
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40);
    if (length > max)
        throw new FrameError("tooLarge", `Payload larger than ${max} bytes`);
    const signed = (flags & FLAG_SIGNED) !== 0;
    const expected = HEADER_BYTES + length + (signed ? SIGNATURE_BYTES : 0);
    if (bytes.length < expected)
        throw new FrameError("truncated", "Frame shorter than announced");
    if (bytes.length > expected)
        throw new FrameError("format", "Unexpected bytes after the frame");
    const raw = bytes.slice(HEADER_BYTES, HEADER_BYTES + length);
    const compressed = (flags & FLAG_COMPRESSED) !== 0;
    const payload = compressed ? await inflate(raw, max) : raw;
    return {
        type: type,
        docId: bytesToUuid(bytes.slice(8, 24)),
        senderId: bytes.slice(24, 40),
        payload,
        compressed,
        signedBytes: bytes.slice(0, HEADER_BYTES + length),
        ...(signed ? { signature: bytes.slice(HEADER_BYTES + length) } : {}),
    };
}
// --- Several frames in one transfer ----------------------------------------
/** Default limit of frames carried by one transfer. */
export const DEFAULT_MAX_FRAMES = 8;
/** Frames sent together (one QR transfer): they are self-delimiting, so simply concatenated. */
export function joinFrames(frames) {
    const out = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
        out.set(f, at);
        at += f.length;
    }
    return out;
}
/**
 * Split a transfer into its frames, checking each header's magic, version
 * and announced length (not the content: `decodeFrame` does that).
 */
export function splitFrames(bytes, opts = {}) {
    const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = [];
    let at = 0;
    while (at < bytes.length) {
        if (frames.length >= maxFrames)
            throw new FrameError("tooLarge", `More than ${maxFrames} frames`);
        if (bytes.length - at < HEADER_BYTES)
            throw new FrameError("truncated", "Frame shorter than its header");
        if (MAGIC.some((b, i) => bytes[at + i] !== b))
            throw new FrameError("format", "Not an offline sync frame");
        if (bytes[at + 4] !== FORMAT_VERSION)
            throw new FrameError("version", `Unknown frame format version ${bytes[at + 4]}`);
        const length = view.getUint32(at + 40);
        if (length > max)
            throw new FrameError("tooLarge", `Payload larger than ${max} bytes`);
        const end = at + HEADER_BYTES + length + (bytes[at + 6] & FLAG_SIGNED ? SIGNATURE_BYTES : 0);
        if (end > bytes.length)
            throw new FrameError("truncated", "Frame shorter than announced");
        frames.push(bytes.subarray(at, end));
        at = end;
    }
    if (!frames.length)
        throw new FrameError("truncated", "No frame");
    return frames;
}
