#!/usr/bin/env bun
/**
 * Production build script for QRShare.
 * Bundles the app, workers, and service worker into dist/.
 */
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { Glob } from "bun";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

// Get git commit hash for build metadata
const gitResult = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT });
const buildHash = gitResult.exitCode === 0 ? gitResult.stdout.toString().trim() : "unknown";

// Clean dist
if (existsSync(DIST)) {
  const rmResult = Bun.spawnSync(["rm", "-rf", DIST]);
  if (rmResult.exitCode !== 0) {
    console.error("Failed to clean dist/");
    process.exit(1);
  }
}
mkdirSync(DIST, { recursive: true });
mkdirSync(join(DIST, "assets"), { recursive: true });

// 1. Build main app entry
const mainResult = await Bun.build({
  entrypoints: [join(ROOT, "src/main.tsx")],
  outdir: DIST,
  minify: true,
  target: "browser",
  naming: "[name].[hash].[ext]",
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },
});
if (!mainResult.success) {
  console.error("Main build failed:", mainResult.logs);
  process.exit(1);
}

// 2. Build workers
const workerResult = await Bun.build({
  entrypoints: [
    join(ROOT, "src/workers/encode-worker.ts"),
    join(ROOT, "src/workers/decode-worker.ts"),
  ],
  outdir: DIST,
  minify: true,
  target: "browser",
  naming: "[name].[ext]",
});
if (!workerResult.success) {
  console.error("Worker build failed:", workerResult.logs);
  process.exit(1);
}

// 3. Build service worker
const swResult = await Bun.build({
  entrypoints: [join(ROOT, "src/sw.ts")],
  outdir: DIST,
  minify: true,
  target: "browser",
  naming: "[name].[ext]",
});
if (!swResult.success) {
  console.error("Service Worker build failed:", swResult.logs);
  process.exit(1);
}

// 4. Build CSS
const cssResult = await Bun.build({
  entrypoints: [join(ROOT, "src/styles.css")],
  outdir: DIST,
  minify: true,
  naming: "[name].[hash].[ext]",
});
if (!cssResult.success) {
  console.error("CSS build failed:", cssResult.logs);
  process.exit(1);
}

// 5. Copy static assets
const staticFiles = [
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/QRShare.png",
];

for (const file of staticFiles) {
  const src = join(ROOT, file);
  const dest = join(DIST, file);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

// 6. Copy WASM files from node_modules
const wasmGlob = new Glob("**/*.wasm");
const nodeModulesPath = join(ROOT, "node_modules");
for await (const path of wasmGlob.scan(nodeModulesPath)) {
  const src = join(nodeModulesPath, path);
  const filename = path.split("/").pop()!;
  copyFileSync(src, join(DIST, filename));
}

// 7. Generate index.html with hashed asset references
const mainBundle = mainResult.outputs.find((o) => o.path.endsWith(".js"));
const cssBundle = cssResult.outputs.find((o) => o.path.endsWith(".css"));

const mainJs = mainBundle ? mainBundle.path.split("/").pop() : "main.js";
const cssFn = cssBundle ? cssBundle.path.split("/").pop() : "styles.css";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="description" content="Air-gapped file transfer via animated QR codes with fountain codes">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <title>QRShare</title>
  <link rel="stylesheet" href="${cssFn}">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${mainJs}"></script>
</body>
</html>`;

await Bun.write(join(DIST, "index.html"), html);

// Summary
const outputs = [
  ...mainResult.outputs,
  ...workerResult.outputs,
  ...swResult.outputs,
  ...cssResult.outputs,
];
let totalSize = 0;
for (const output of outputs) {
  totalSize += output.size;
}

console.log(`Build complete: ${outputs.length} files, ${(totalSize / 1024).toFixed(0)} KB total`);
console.log(`Output: ${DIST}`);
