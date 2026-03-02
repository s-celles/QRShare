#!/usr/bin/env bun
/**
 * Packages the built QRShare app into a single self-contained HTML file.
 * All JS, CSS are inlined; WASM and icons are base64-encoded as data URIs.
 * Run `bun run build` first, then `bun run package`.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("Error: dist/ not found. Run `bun run build` first.");
  process.exit(1);
}

const indexHtml = readFileSync(join(DIST, "index.html"), "utf-8");

// Extract referenced JS and CSS filenames from index.html
const jsMatch = indexHtml.match(/src="([^"]+\.js)"/);
const cssMatch = indexHtml.match(/href="([^"]+\.css)"/);

if (!jsMatch || !cssMatch) {
  console.error("Error: Could not find JS or CSS references in index.html");
  process.exit(1);
}

const jsContent = readFileSync(join(DIST, jsMatch[1]), "utf-8");
const cssContent = readFileSync(join(DIST, cssMatch[1]), "utf-8");

// Read and base64-encode icon assets
function toDataUri(filePath: string, mimeType: string): string {
  if (!existsSync(filePath)) return "";
  const data = readFileSync(filePath);
  return `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
}

const iconSvgUri = toDataUri(join(DIST, "assets/icon.svg"), "image/svg+xml");

const singleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="description" content="Air-gapped file transfer via animated QR codes with fountain codes">
  ${iconSvgUri ? `<link rel="icon" href="${iconSvgUri}" type="image/svg+xml">` : ""}
  <title>QRShare</title>
  <style>${cssContent}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module">${jsContent}</script>
</body>
</html>`;

const outPath = join(ROOT, "qrshare.html");
await Bun.write(outPath, singleHtml);

const size = (singleHtml.length / 1024).toFixed(0);
console.log(`Packaged: ${outPath} (${size} KB)`);
