import { describe, expect, it } from "bun:test";
import { isMedia, isRaster, sniff, sniffedMime } from "@/paste/attachments/sniff";

const b = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...new TextEncoder().encode(p)] : p));
  return Uint8Array.from([...out, ...new Array(32).fill(0)]);
};

describe("REQ-PASTE-039 magic-byte detection", () => {
  it("detects each supported signature", () => {
    expect(sniff(b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniff(b([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniff(b("GIF87a"))).toBe("gif");
    expect(sniff(b("GIF89a"))).toBe("gif");
    expect(sniff(b("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
    expect(sniff(b("RIFF", [1, 2, 3, 4], "WAVEfmt "))).toBe("wav");
    expect(sniff(b("ID3", [4, 0]))).toBe("mp3");
    expect(sniff(b([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
    expect(sniff(b("OggS", [0]))).toBe("ogg");
    expect(sniff(b([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
    expect(sniff(b([0, 0, 0, 0x20], "ftypisom"))).toBe("mp4");
  });

  it("treats SVG, HTML, PDF, ZIP, ELF and EXE as other", () => {
    expect(sniff(b('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe("other");
    expect(sniff(b('<?xml version="1.0"?><svg/>'))).toBe("other");
    expect(sniff(b("<!doctype html><script>alert(1)</script>"))).toBe("other");
    expect(sniff(b("%PDF-1.7"))).toBe("other");
    expect(sniff(b("PK", [3, 4]))).toBe("other");
    expect(sniff(b([0x7f], "ELF"))).toBe("other");
    expect(sniff(b("MZ", [0x90, 0]))).toBe("other");
    expect(sniff(new Uint8Array(0))).toBe("other");
    expect(sniff(Uint8Array.from([0x89, 0x50]))).toBe("other");
  });

  it("ignores the declared type and name (an HTML file named .png is other)", () => {
    // the API takes bytes only: there is no way to pass a MIME type or a name
    expect(sniff.length).toBe(1);
    expect(sniff(b("<html><body onload=alert(1)>"))).toBe("other");
  });

  it("maps sniffed kinds to display classes and MIME types", () => {
    expect(isRaster("png") && isRaster("jpeg") && isRaster("webp") && isRaster("gif")).toBe(true);
    expect(isRaster("other") || isRaster("mp4")).toBe(false);
    expect(isMedia("mp3")).toBe("audio");
    expect(isMedia("ogg")).toBe("audio");
    expect(isMedia("wav")).toBe("audio");
    expect(isMedia("webm")).toBe("video");
    expect(isMedia("mp4")).toBe("video");
    expect(isMedia("png")).toBeNull();
    expect(sniffedMime("webp")).toBe("image/webp");
    expect(sniffedMime("other")).toBe("application/octet-stream");
  });
});
