/**
 * Real pixel size of an image, read from its header without decoding it, so that an
 * image from an untrusted peer is shown inline only when it cannot exhaust memory (at most 2048 × 2048 pixels)
 * when decoded (decompression bomb) and matches the size signed in its statement.
 */
import { sniff } from "./sniff";

export const MAX_INLINE_SIDE = 2048;

export interface Dimensions {
  width: number;
  height: number;
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function jpeg(b: Uint8Array): Dimensions | null {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) {
      o++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = be16(b, o + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (o + 9 > b.length) return null;
      return { height: be16(b, o + 5), width: be16(b, o + 7) };
    }
    if (m === 0xda || m === 0xd9 || len < 2) return null;
    o += 2 + len;
  }
  return null;
}

/**
 * The logical screen, once the first image descriptor (after the optional global colour
 * table and any extension blocks) is found and lies within it: a small screen with a
 * huge first frame is a decompression bomb.
 */
function gif(b: Uint8Array): Dimensions | null {
  if (b.length < 13) return null;
  const screen = { width: le16(b, 6), height: le16(b, 8) };
  let o = 13;
  if (b[10] & 0x80) o += 3 * 2 ** ((b[10] & 7) + 1);
  while (o < b.length) {
    const block = b[o];
    if (block === 0x2c) {
      if (o + 9 >= b.length) return null;
      const left = le16(b, o + 1);
      const top = le16(b, o + 3);
      const width = le16(b, o + 5);
      const height = le16(b, o + 7);
      return left + width <= screen.width && top + height <= screen.height ? screen : null;
    }
    if (block !== 0x21 || o + 2 >= b.length) return null; // trailer or junk before any frame
    o += 2; // introducer and label, then size-prefixed sub-blocks up to a 0 terminator
    while (o < b.length && b[o] !== 0) o += b[o] + 1;
    o++;
  }
  return null;
}

function webp(b: Uint8Array): Dimensions | null {
  if (b.length < 25) return null;
  const chunk = fourcc(b, 12);
  const d = 20;
  if (chunk !== "VP8L" && b.length < d + 10) return null;
  if (chunk === "VP8X") return { width: le24(b, d + 4) + 1, height: le24(b, d + 7) + 1 };
  if (chunk === "VP8L") {
    if (b[d] !== 0x2f) return null;
    const v = le32(b, d + 1);
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    return { width: le16(b, d + 6) & 0x3fff, height: le16(b, d + 8) & 0x3fff };
  }
  return null;
}

export function imageDimensions(bytes: Uint8Array): Dimensions | null {
  switch (sniff(bytes)) {
    case "png":
      return bytes.length >= 24 && fourcc(bytes, 12) === "IHDR" ? { width: be32(bytes, 16), height: be32(bytes, 20) } : null;
    case "gif":
      return gif(bytes);
    case "jpeg":
      return jpeg(bytes);
    case "webp":
      return webp(bytes);
    default:
      return null;
  }
}

/** Inline display is allowed for at most 2048×2048 pixels, equal to the signed size. */
export function inlineImageOk(bytes: Uint8Array, signed: Dimensions): boolean {
  const d = imageDimensions(bytes);
  if (!d || d.width < 1 || d.height < 1 || d.width > MAX_INLINE_SIDE || d.height > MAX_INLINE_SIDE) return false;
  return d.width === signed.width && d.height === signed.height;
}
