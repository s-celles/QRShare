/**
 * Second layer of image anonymisation (REQ-PASTE-031): after re-encoding through a
 * canvas, remove any metadata container that may remain — JPEG APP1–APP15 and COM
 * segments, PNG ancillary chunks other than tRNS/gAMA/sRGB, WebP EXIF/XMP/ICCP
 * chunks (fixing the RIFF size and VP8X flags). Malformed input throws.
 */
import { crc32 } from "@/audio/crc32";
import { sniff } from "./sniff";

class ImageFormatError extends Error {}

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

const PNG_KEEP = new Set(["tRNS", "gAMA", "sRGB"]);
const WEBP_DROP = new Set(["EXIF", "XMP ", "ICCP"]);
const isJpegMetadata = (m: number) => (m >= 0xe1 && m <= 0xef) || m === 0xfe;

function jpegSegments(bytes: Uint8Array): { marker: number; start: number; end: number }[] {
  const segments: { marker: number; start: number; end: number }[] = [];
  let o = 2;
  while (o < bytes.length) {
    if (bytes[o] !== 0xff) throw new ImageFormatError("JPEG: marker expected");
    const marker = bytes[o + 1];
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: o, end: o + 2 });
      o += 2;
      continue;
    }
    if (marker === 0xd9) {
      segments.push({ marker, start: o, end: o + 2 });
      return segments;
    }
    if (o + 4 > bytes.length) throw new ImageFormatError("JPEG: truncated segment");
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    if (len < 2 || o + 2 + len > bytes.length) throw new ImageFormatError("JPEG: bad segment length");
    if (marker === 0xda) {
      // the scan and everything after it (entropy data, EOI) are copied as they are
      segments.push({ marker, start: o, end: bytes.length });
      return segments;
    }
    segments.push({ marker, start: o, end: o + 2 + len });
    o += 2 + len;
  }
  throw new ImageFormatError("JPEG: no scan");
}

function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; start: number; end: number }[] = [];
  let o = 8;
  while (o < bytes.length) {
    if (o + 12 > bytes.length) throw new ImageFormatError("PNG: truncated chunk");
    const len = view.getUint32(o);
    if (o + 12 + len > bytes.length) throw new ImageFormatError("PNG: truncated chunk");
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    if (view.getUint32(o + 8 + len) !== crc32(bytes.subarray(o + 4, o + 8 + len))) throw new ImageFormatError("PNG: bad CRC");
    chunks.push({ type, start: o, end: o + 12 + len });
    o += 12 + len;
    if (type === "IEND") break;
  }
  if (chunks[0]?.type !== "IHDR" || chunks[chunks.length - 1]?.type !== "IEND") throw new ImageFormatError("PNG: bad layout");
  return chunks;
}

function webpChunks(bytes: Uint8Array): { fourcc: string; start: number; end: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(4, true) + 8 !== bytes.length) throw new ImageFormatError("WebP: bad RIFF size");
  const chunks: { fourcc: string; start: number; end: number }[] = [];
  let o = 12;
  while (o < bytes.length) {
    if (o + 8 > bytes.length) throw new ImageFormatError("WebP: truncated chunk");
    const len = view.getUint32(o + 4, true);
    const end = o + 8 + len + (len % 2);
    if (end > bytes.length) throw new ImageFormatError("WebP: truncated chunk");
    chunks.push({ fourcc: String.fromCharCode(...bytes.subarray(o, o + 4)), start: o, end });
    o = end;
  }
  return chunks;
}

export function hasImageMetadata(bytes: Uint8Array): boolean {
  switch (sniff(bytes)) {
    case "jpeg":
      return jpegSegments(bytes).some((s) => isJpegMetadata(s.marker));
    case "png":
      return pngChunks(bytes).some((c) => c.type.charCodeAt(0) >= 0x61 && !PNG_KEEP.has(c.type));
    case "webp":
      return webpChunks(bytes).some((c) => WEBP_DROP.has(c.fourcc));
    default:
      return false;
  }
}

/** The image without its metadata (same bytes when there was none). */
export function scrubImageMetadata(bytes: Uint8Array): Uint8Array {
  switch (sniff(bytes)) {
    case "jpeg": {
      const segments = jpegSegments(bytes);
      if (!segments.some((s) => isJpegMetadata(s.marker))) return bytes;
      return cat([bytes.subarray(0, 2), ...segments.filter((s) => !isJpegMetadata(s.marker)).map((s) => bytes.subarray(s.start, s.end))]);
    }
    case "png": {
      const chunks = pngChunks(bytes);
      const kept = chunks.filter((c) => c.type.charCodeAt(0) < 0x61 || PNG_KEEP.has(c.type));
      if (kept.length === chunks.length) return bytes;
      return cat([bytes.subarray(0, 8), ...kept.map((c) => bytes.subarray(c.start, c.end))]);
    }
    case "webp": {
      const chunks = webpChunks(bytes);
      const kept = chunks.filter((c) => !WEBP_DROP.has(c.fourcc));
      if (kept.length === chunks.length) return bytes;
      const out = cat([bytes.subarray(0, 12), ...kept.map((c) => bytes.subarray(c.start, c.end))]);
      new DataView(out.buffer).setUint32(4, out.length - 8, true);
      let o = 12;
      for (const c of kept) {
        if (c.fourcc === "VP8X") out[o + 8] &= ~(0x20 | 0x08 | 0x04); // ICC, EXIF, XMP flags
        o += c.end - c.start;
      }
      return out;
    }
    default:
      throw new ImageFormatError("Not a PNG, JPEG or WebP image");
  }
}
