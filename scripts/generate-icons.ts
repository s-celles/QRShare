#!/usr/bin/env bun
/**
 * Generates the PNG icons referenced by manifest.webmanifest from SVG sources:
 *
 * - assets/icon-maskable-192.png, assets/icon-maskable-512.png — maskable icons:
 *   a full-bleed background (no transparency, no rounded corners) with the
 *   artwork of assets/icon.svg scaled so its whole bounding box lies inside the
 *   safe zone, the centred circle of radius 40 % of the icon size that every
 *   mask keeps (https://www.w3.org/TR/appmanifest/#icon-masks).
 * - assets/shortcuts/*-96.png — 96 × 96 icons for the manifest shortcuts.
 *
 * The images are rendered by a headless Chromium (see scripts/chromium.ts);
 * the PNGs are committed, so this only needs to run when the artwork changes:
 *   bun run icons
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findChromium, pngSize, screenshot } from "./chromium";

const ROOT = join(import.meta.dir, "..");
const ASSETS = join(ROOT, "assets");
const BLUE = "#1f5fbf";
const LIGHT = "#cfe0ff";

/** Inner artwork of assets/icon.svg: the <g> element, which spans 384 × 384 units from (64, 64). */
function iconArtwork(): string {
  const svg = readFileSync(join(ASSETS, "icon.svg"), "utf-8");
  const match = svg.match(/<g[\s\S]*<\/g>/);
  if (!match) throw new Error("assets/icon.svg: artwork group not found");
  // Drop the original translate: the maskable layout positions the group itself.
  return match[0].replace(/\s*transform="[^"]*"/, "");
}

const ARTWORK_SIZE = 384;
/** Safe zone: a centred circle whose diameter is 80 % of the icon. */
const SAFE_ZONE_RATIO = 0.8;

function maskableSvg(): string {
  // The artwork's square bounding box must fit inside the safe-zone circle:
  // its diagonal (side × √2) may not exceed 80 % of the 512-unit canvas.
  const maxSide = (512 * SAFE_ZONE_RATIO) / Math.SQRT2; // ≈ 289.6
  const side = Math.floor(maxSide) - 1; // small margin
  const scale = side / ARTWORK_SIZE;
  const offset = (512 - side) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BLUE}"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">${iconArtwork()}</g>
</svg>`;
}

/** Shortcut glyphs, drawn on a 96-unit canvas in white over the brand blue. */
const SHORTCUTS: Record<string, string> = {
  // Viewfinder corners with a scan line.
  scan: `<path d="M22 36V22h14M60 22h14v14M74 60v14H60M36 74H22V60" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M30 48h36" stroke="${LIGHT}" stroke-width="6" stroke-linecap="round"/>`,
  // A QR finder pattern with a plus sign.
  create: `<rect x="18" y="18" width="34" height="34" rx="4" fill="#fff"/>
    <rect x="25" y="25" width="20" height="20" rx="2" fill="${BLUE}"/>
    <rect x="30" y="30" width="10" height="10" rx="1" fill="#fff"/>
    <path d="M64 50v28M50 64h28" stroke="${LIGHT}" stroke-width="8" stroke-linecap="round"/>`,
  // Arrow leaving a tray (upwards).
  send: `<path d="M48 62V22M32 38l16-16 16 16" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M22 60v12h52V60" fill="none" stroke="${LIGHT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Arrow entering a tray (downwards).
  receive: `<path d="M48 22v40M32 46l16 16 16-16" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M22 60v12h52V60" fill="none" stroke="${LIGHT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function shortcutSvg(glyph: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="18" fill="${BLUE}"/>
  ${glyph}
</svg>`;
}

/** Wraps an SVG in a page that draws it at exactly size × size pixels. */
function page(svg: string, size: number): string {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${sized}</body></html>`;
}

function render(chrome: string, work: string, svg: string, size: number, out: string, transparent: boolean): void {
  const htmlPath = join(work, `render-${size}.html`);
  writeFileSync(htmlPath, page(svg, size));
  screenshot(chrome, { url: `file://${htmlPath}`, width: size, height: size, out, transparent, settleMs: 500 });
  const actual = pngSize(readFileSync(out));
  if (actual.width !== size || actual.height !== size) {
    throw new Error(`${out}: expected ${size}x${size}, got ${actual.width}x${actual.height}`);
  }
  console.log(`  ${out.slice(ROOT.length + 1)} (${size}x${size})`);
}

if (import.meta.main) {
  const chrome = findChromium();
  const work = mkdtempSync(join(tmpdir(), "qrshare-icons-"));
  try {
    console.log(`Rendering icons with ${chrome}`);
    const maskable = maskableSvg();
    for (const size of [192, 512]) {
      render(chrome, work, maskable, size, join(ASSETS, `icon-maskable-${size}.png`), false);
    }
    mkdirSync(join(ASSETS, "shortcuts"), { recursive: true });
    for (const [name, glyph] of Object.entries(SHORTCUTS)) {
      render(chrome, work, shortcutSvg(glyph), 96, join(ASSETS, "shortcuts", `${name}-96.png`), true);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
