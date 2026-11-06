import { describe, expect, it } from "bun:test";
import { hasImageMetadata, scrubImageMetadata } from "@/paste/attachments/metadata";
import { cleanJpeg, cleanPng, cleanWebp, dirtyJpeg, dirtyPng, dirtyWebp, jpegMarkers, pngChunks, webpChunks } from "./image-fixtures";

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("REQ-PASTE-031 image metadata scrubbing", () => {
  it("removes JPEG APP1–APP15 and COM segments, keeping the scan intact", () => {
    const dirty = dirtyJpeg();
    expect(hasImageMetadata(dirty)).toBe(true);
    const out = scrubImageMetadata(dirty);
    expect(hasImageMetadata(out)).toBe(false);
    expect(jpegMarkers(out)).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
    expect(text(out)).not.toContain("GPS");
    expect(text(out)).not.toContain("Jane");
    expect(text(out)).not.toContain("ICC_PROFILE");
    expect([...out.subarray(out.length - 9)]).toEqual([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
  });

  it("removes PNG ancillary chunks except tRNS, gAMA and sRGB, with valid CRCs", () => {
    const dirty = dirtyPng();
    expect(hasImageMetadata(dirty)).toBe(true);
    const out = scrubImageMetadata(dirty);
    expect(hasImageMetadata(out)).toBe(false);
    expect(pngChunks(out)).toEqual(["IHDR", "tRNS", "IDAT", "IEND"]);
    expect(text(out)).not.toContain("GPS");
    expect(text(out)).not.toContain("Jane");
  });

  it("removes WebP EXIF, XMP and ICCP chunks and fixes the RIFF size and VP8X flags", () => {
    const dirty = dirtyWebp();
    expect(hasImageMetadata(dirty)).toBe(true);
    expect(webpChunks(dirty).flags).toBe(0x3c);
    const out = scrubImageMetadata(dirty);
    expect(hasImageMetadata(out)).toBe(false);
    const parsed = webpChunks(out);
    expect(parsed.fourccs).toEqual(["VP8X", "VP8L"]);
    expect(parsed.flags).toBe(0x10); // alpha kept, ICC/EXIF/XMP cleared
    expect(text(out)).not.toContain("GPS");
  });

  it("leaves clean images unchanged", () => {
    for (const clean of [cleanJpeg(), cleanPng(), cleanWebp()]) {
      expect(hasImageMetadata(clean)).toBe(false);
      expect([...scrubImageMetadata(clean)]).toEqual([...clean]);
    }
  });

  it("refuses malformed images instead of passing them through", () => {
    const truncated = dirtyPng().subarray(0, 40);
    expect(() => scrubImageMetadata(truncated)).toThrow();
    expect(() => scrubImageMetadata(new TextEncoder().encode("<svg/>"))).toThrow();
  });
});
