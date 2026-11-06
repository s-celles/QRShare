/** Small, structurally valid images with metadata, built in code (no third-party files). */
import { crc32 } from "@/audio/crc32";

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
const u32be = (n: number) => Uint8Array.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = (n: number) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
const u16be = (n: number) => Uint8Array.from([n >>> 8, n & 255]);

export const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const t = enc.encode(type);
  return cat(u32be(data.length), t, data, u32be(crc32(cat(t, data))));
}

const IHDR = pngChunk("IHDR", cat(u32be(1), u32be(1), Uint8Array.from([8, 6, 0, 0, 0])));
const IDAT = pngChunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01]));
const IEND = pngChunk("IEND", new Uint8Array(0));

export function cleanPng(): Uint8Array {
  return cat(PNG_SIG, IHDR, pngChunk("sRGB", Uint8Array.from([0])), IDAT, IEND);
}

export function dirtyPng(): Uint8Array {
  return cat(
    PNG_SIG,
    IHDR,
    pngChunk("iCCP", enc.encode("profile\0\0xxxx")),
    pngChunk("eXIf", enc.encode("MM\0*GPS 48.85N 2.35E")),
    pngChunk("tEXt", enc.encode("Author\0Jane Doe")),
    pngChunk("tRNS", Uint8Array.from([0, 0])),
    IDAT,
    pngChunk("iTXt", enc.encode("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>")),
    pngChunk("tIME", Uint8Array.from([7, 234, 11, 5, 12, 0, 0])),
    IEND,
  );
}

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  return cat(Uint8Array.from([0xff, marker]), u16be(data.length + 2), data);
}

const JFIF = jpegSegment(0xe0, cat(enc.encode("JFIF\0"), Uint8Array.from([1, 1, 0, 0, 1, 0, 1, 0, 0])));
const DQT = jpegSegment(0xdb, new Uint8Array(65));
const SOF = jpegSegment(0xc0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const SOS = jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0]));
// entropy-coded data contains a stuffed FF 00 and a restart marker, which must be kept
const SCAN = Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
const EOI = Uint8Array.from([0xff, 0xd9]);

export function cleanJpeg(): Uint8Array {
  return cat(Uint8Array.from([0xff, 0xd8]), JFIF, DQT, SOF, SOS, SCAN, EOI);
}

export function dirtyJpeg(): Uint8Array {
  return cat(
    Uint8Array.from([0xff, 0xd8]),
    JFIF,
    jpegSegment(0xe1, enc.encode("Exif\0\0MM\0*GPSLatitude 48.8566 GPSLongitude 2.3522 Make Phone")),
    jpegSegment(0xe1, enc.encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
    jpegSegment(0xe2, enc.encode("ICC_PROFILE\0\x01\x01xxxx")),
    DQT,
    jpegSegment(0xfe, enc.encode("taken by Jane")),
    SOF,
    jpegSegment(0xed, enc.encode("Photoshop 3.0\0")),
    SOS,
    SCAN,
    EOI,
  );
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 ? Uint8Array.from([0]) : new Uint8Array(0);
  return cat(enc.encode(fourcc), u32le(data.length), data, pad);
}

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = cat(enc.encode("WEBP"), ...chunks);
  return cat(enc.encode("RIFF"), u32le(body.length), body);
}

const VP8L = riffChunk("VP8L", Uint8Array.from([0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0]));

export function cleanWebp(): Uint8Array {
  return riff([VP8L]);
}

/** VP8X with ICC, EXIF and XMP flags (0x2c) and an odd-sized EXIF chunk (padding). */
export function dirtyWebp(): Uint8Array {
  const vp8x = riffChunk("VP8X", Uint8Array.from([0x2c | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  return riff([vp8x, riffChunk("ICCP", enc.encode("icc!")), VP8L, riffChunk("EXIF", enc.encode("MM\0*GPS!")), riffChunk("XMP ", enc.encode("<x:xmpmeta/>"))]);
}

/** Walks PNG chunks, checking lengths and CRCs; returns their types. */
export function pngChunks(bytes: Uint8Array): string[] {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) throw new Error("bad signature");
  const types: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  while (o < bytes.length) {
    const len = view.getUint32(o);
    const type = new TextDecoder().decode(bytes.subarray(o + 4, o + 8));
    if (o + 12 + len > bytes.length) throw new Error("truncated chunk");
    if (view.getUint32(o + 8 + len) !== crc32(bytes.subarray(o + 4, o + 8 + len))) throw new Error(`bad CRC in ${type}`);
    types.push(type);
    o += 12 + len;
  }
  if (types[0] !== "IHDR" || types[types.length - 1] !== "IEND") throw new Error("bad layout");
  return types;
}

/** Walks JPEG segments up to SOS; returns their markers. Throws on bad layout. */
export function jpegMarkers(bytes: Uint8Array): number[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("no SOI");
  const markers: number[] = [];
  let o = 2;
  while (o < bytes.length) {
    if (bytes[o] !== 0xff) throw new Error(`no marker at ${o}`);
    const m = bytes[o + 1];
    markers.push(m);
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    if (m === 0xda) {
      if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error("no EOI");
      return markers;
    }
    o += 2 + len;
  }
  throw new Error("no SOS");
}

/** Walks WebP chunks, checking the RIFF size; returns fourccs and the VP8X flags. */
export function webpChunks(bytes: Uint8Array): { fourccs: string[]; flags?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  if (dec.decode(bytes.subarray(0, 4)) !== "RIFF" || dec.decode(bytes.subarray(8, 12)) !== "WEBP") throw new Error("not webp");
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error("bad RIFF size");
  const fourccs: string[] = [];
  let flags: number | undefined;
  let o = 12;
  while (o < bytes.length) {
    const fourcc = dec.decode(bytes.subarray(o, o + 4));
    const len = view.getUint32(o + 4, true);
    if (fourcc === "VP8X") flags = bytes[o + 8];
    fourccs.push(fourcc);
    o += 8 + len + (len % 2);
  }
  if (o !== bytes.length) throw new Error("trailing bytes");
  return { fourccs, flags };
}
