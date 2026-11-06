import { describe, expect, it } from "bun:test";
import { MAX_INLINE_SIDE, imageDimensions, inlineImageOk } from "@/paste/attachments/dimensions";
import { cleanJpeg, cleanPng, cleanWebp, pngChunk, PNG_SIG } from "./image-fixtures";

const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const png = (w: number, h: number) => new Uint8Array([...PNG_SIG, ...pngChunk("IHDR", Uint8Array.from([...u32(w), ...u32(h), 8, 6, 0, 0, 0]))]);
const le = (n: number) => [n & 255, (n >> 8) & 255];
/** Logical screen w×h, optional 2-colour global table and graphic control extension, then a first frame fw×fh. */
function gif(w: number, h: number, frame: [number, number] = [w, h], extras = false) {
  const table = extras ? [0, 0, 0, 255, 255, 255] : [];
  const gce = extras ? [0x21, 0xf9, 4, 0, 0, 0, 0, 0] : [];
  return new Uint8Array([
    ...new TextEncoder().encode("GIF89a"), ...le(w), ...le(h), extras ? 0x80 : 0, 0, 0, ...table, ...gce,
    0x2c, ...le(0), ...le(0), ...le(frame[0]), ...le(frame[1]), 0, 2, 2, 0x4c, 0x01, 0, 0x3b,
  ]);
}
const jpeg = (w: number, h: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
function riff(fourcc: string, data: number[]) {
  const enc = new TextEncoder();
  const chunk = [...enc.encode(fourcc), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data];
  const body = [...enc.encode("WEBP"), ...chunk];
  return Uint8Array.from([...enc.encode("RIFF"), body.length & 255, (body.length >> 8) & 255, 0, 0, ...body]);
}
const vp8x = (w: number, h: number) => riff("VP8X", [0, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16, (h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16]);
const vp8 = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f]);
function vp8l(w: number, h: number) {
  const v = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [0x2f, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
}

describe("REQ-PASTE-040 real image dimensions", () => {
  it("reads PNG, GIF, JPEG and WebP (VP8, VP8L, VP8X) headers", () => {
    expect(imageDimensions(cleanPng())).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(cleanJpeg())).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(cleanWebp())).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(png(50000, 50000))).toEqual({ width: 50000, height: 50000 });
    expect(imageDimensions(gif(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(jpeg(3000, 2000))).toEqual({ width: 3000, height: 2000 });
    expect(imageDimensions(vp8x(16383, 9000))).toEqual({ width: 16383, height: 9000 });
    expect(imageDimensions(vp8(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(vp8l(16384, 2))).toEqual({ width: 16384, height: 2 });
    expect(imageDimensions(new TextEncoder().encode("<svg/>"))).toBeNull();
    expect(imageDimensions(PNG_SIG)).toBeNull();
  });

  it("inlines only images within 2048×2048 whose real size matches the signed size", () => {
    expect(MAX_INLINE_SIDE).toBe(2048);
    expect(inlineImageOk(gif(640, 480), { width: 640, height: 480 })).toBe(true);
    expect(inlineImageOk(gif(640, 480), { width: 10, height: 10 })).toBe(false);
    expect(inlineImageOk(png(50000, 50000), { width: 50000 % 65536, height: 50000 })).toBe(false);
    expect(inlineImageOk(vp8x(2049, 10), { width: 2049, height: 10 })).toBe(false);
    expect(inlineImageOk(jpeg(2048, 2048), { width: 2048, height: 2048 })).toBe(true);
    expect(inlineImageOk(jpeg(2049, 100), { width: 2049, height: 100 })).toBe(false);
    expect(inlineImageOk(new Uint8Array(10), { width: 0, height: 0 })).toBe(false);
  });

  it("checks the first GIF frame against the logical screen", () => {
    // colour table and extension before the first image descriptor
    expect(imageDimensions(gif(300, 200, [300, 200], true))).toEqual({ width: 300, height: 200 });
    // a small screen with a huge first frame (decompression bomb)
    expect(imageDimensions(gif(640, 480, [60000, 60000]))).toBeNull();
    expect(inlineImageOk(gif(640, 480, [60000, 60000]), { width: 640, height: 480 })).toBe(false);
    // no image descriptor at all
    expect(imageDimensions(new Uint8Array([...new TextEncoder().encode("GIF89a"), 10, 0, 10, 0, 0, 0, 0, 0x3b]))).toBeNull();
  });
});
