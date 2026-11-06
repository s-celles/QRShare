/**
 * Web app manifest checks (REQ-PLT-003, REQ-PLT-017, REQ-PLT-018): the fields PWABuilder's report card
 * looks for, and every image the manifest references exists at its declared
 * pixel size.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { inflateSync } from "zlib";

const ROOT = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.webmanifest"), "utf-8"));

interface ImageResource {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
  form_factor?: string;
  label?: string;
}

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Alpha of the four corner pixels of an 8-bit, non-interlaced RGB(A) PNG. */
function cornerAlphas(path: string): number[] {
  const bytes = readFileSync(path);
  const { width, height } = pngSize(path);
  const colourType = bytes[25];
  expect(bytes[24]).toBe(8);
  expect(bytes[28]).toBe(0);
  if (colourType === 2) return [255, 255, 255, 255];
  expect(colourType).toBe(6);
  const chunks: Buffer[] = [];
  for (let off = 8; off < bytes.length; ) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") chunks.push(bytes.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const alpha = (x: number, y: number) => pixels[y * stride + x * bpp + 3];
  return [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)];
}

function checkImage(image: ImageResource): { width: number; height: number } | null {
  const path = join(ROOT, image.src);
  expect(existsSync(path)).toBe(true);
  if (image.type !== "image/png") return null;
  const size = pngSize(path);
  expect(image.sizes).toBe(`${size.width}x${size.height}`);
  return size;
}

const allImages = (): ImageResource[] => [
  ...manifest.icons,
  ...manifest.screenshots,
  ...manifest.shortcuts.flatMap((s: { icons?: ImageResource[] }) => s.icons ?? []),
];

describe("manifest.webmanifest", () => {
  test("has the required identity fields", () => {
    expect(manifest.name).toBe("QRShare");
    expect(manifest.short_name).toBe("QRShare");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
  });

  test("keeps the install identity of the deployed app", () => {
    // Without "id", browsers used the resolved start_url
    // (https://s-celles.github.io/QRShare/). "id" resolves against the
    // origin of start_url, not against the manifest URL, so it must be the
    // absolute path "/QRShare/", not "./".
    expect(manifest.id).toBe("/QRShare/");
    const startUrl = new URL(manifest.start_url, "https://s-celles.github.io/QRShare/manifest.webmanifest");
    expect(new URL(manifest.id, startUrl.origin).href).toBe(startUrl.href);
  });

  test("has the recommended presentation fields", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toEqual(["standalone", "minimal-ui"]);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.orientation).toBe("any");
    expect(manifest.lang).toBe("en");
    expect(["ltr", "rtl", "auto"]).toContain(manifest.dir);
    expect(manifest.categories).toEqual(["utilities", "productivity"]);
  });

  test("REQ-PLT-018: opens every launch in a new window so a running transfer is never replaced", () => {
    expect(manifest.launch_handler).toEqual({ client_mode: ["navigate-new"] });
  });

  test("keeps the share target and the handoff advertisement", () => {
    expect(manifest.share_target.action).toBe("./");
    expect(manifest.qrshare_handoff.versions).toEqual([1, 2]);
  });

  test("declares no related native applications", () => {
    expect(manifest.related_applications).toBeUndefined();
    expect(manifest.prefer_related_applications).toBeUndefined();
  });

  test("has purpose-any icons up to 512 px and separate maskable icons", () => {
    const icons: ImageResource[] = manifest.icons;
    const any = icons.filter((i) => i.purpose === "any");
    const maskable = icons.filter((i) => i.purpose === "maskable");
    expect(any.some((i) => i.sizes === "512x512" && i.type === "image/png")).toBe(true);
    expect(maskable.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    // A maskable icon must not double as "any" (PWABuilder packaging rule).
    for (const icon of icons) expect(icon.purpose?.split(" ").length ?? 1).toBe(1);
  });

  test("maskable icons are full-bleed (opaque corners)", () => {
    for (const icon of manifest.icons.filter((i: ImageResource) => i.purpose === "maskable")) {
      // Masks crop the corners: they must be covered by the background, not transparent.
      expect(cornerAlphas(join(ROOT, icon.src))).toEqual([255, 255, 255, 255]);
    }
  });

  test("has wide and narrow screenshots with labels", () => {
    const shots: ImageResource[] = manifest.screenshots;
    for (const factor of ["wide", "narrow"]) {
      const group = shots.filter((s) => s.form_factor === factor);
      expect(group.length).toBeGreaterThan(0);
      for (const shot of group) {
        expect(shot.label?.length ?? 0).toBeGreaterThan(0);
        const size = checkImage(shot)!;
        if (factor === "wide") expect(size.width).toBeGreaterThan(size.height);
        else expect(size.height).toBeGreaterThan(size.width);
      }
    }
  });

  test("shortcuts point to real routes and have 96 px icons", async () => {
    const { isValidRoute } = await import("../src/ui/router");
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(1);
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.name.length).toBeGreaterThan(0);
      expect(shortcut.url).toMatch(/^\.\/#\//);
      expect(isValidRoute(shortcut.url.slice(3))).toBe(true);
      expect(shortcut.icons.some((i: ImageResource) => i.sizes === "96x96")).toBe(true);
    }
  });

  test("every referenced image exists at its declared size", () => {
    for (const image of allImages()) checkImage(image);
  });

  test("every image is copied by the build and every precached asset exists", () => {
    const build = readFileSync(join(ROOT, "scripts/build.ts"), "utf-8");
    for (const image of allImages()) {
      const dir = image.src.includes("/") ? image.src.slice(0, image.src.lastIndexOf("/")) : "";
      expect(build.includes(`"${image.src}"`) || build.includes(`"${dir}"`)).toBe(true);
    }
    const sw = readFileSync(join(ROOT, "src/sw.ts"), "utf-8");
    const precachedAssets = [...sw.matchAll(/"\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(precachedAssets.length).toBeGreaterThan(0);
    for (const asset of precachedAssets) expect(existsSync(join(ROOT, asset))).toBe(true);
  });
});
