/* QRShare worker adapter for the libcimbar decoder API (classic worker). */
"use strict";

let ready = false;
let configuredMode = 0;
const buffers = {};
let scannedFrames = 0;
let detectedFrames = 0;
let expectedSize = 0;
let maxProgress = 0;
let receptionStartedAt = 0;

var Module = {
  preRun: [],
  onRuntimeInitialized() {
    ready = true;
    self.postMessage({ type: "ready" });
  },
};

function allocate(name, size) {
  let buffer = buffers[name];
  if (!buffer || size > buffer.length) {
    if (buffer) Module._free(buffer.byteOffset);
    buffer = new Uint8Array(Module.HEAPU8.buffer, Module._malloc(size), size);
    buffers[name] = buffer;
  } else if (buffer.buffer !== Module.HEAPU8.buffer) {
    buffer = new Uint8Array(Module.HEAPU8.buffer, buffer.byteOffset, buffer.byteLength);
    buffers[name] = buffer;
  }
  return buffer;
}

function report() {
  const error = allocate("report", 2048);
  const length = Module._cimbard_get_report(error.byteOffset, error.length);
  if (length <= 0) return null;
  const text = new TextDecoder().decode(
    new Uint8Array(Module.HEAPU8.buffer, error.byteOffset, length),
  );
  try { return JSON.parse(text); } catch { return text; }
}

function filenameFor(id, size) {
  const name = allocate("filename", 1024);
  const length = Module._cimbard_get_filename(id, name.byteOffset, name.length);
  if (length <= 0) return `cimbar-${id}.${size}`;
  return new TextDecoder().decode(
    new Uint8Array(Module.HEAPU8.buffer, name.byteOffset, length),
  );
}

function splitIntegrityMarker(filename) {
  const match = filename.match(/^(.*)\.qrshare-sha256-([a-f0-9]{64})$/i);
  return match ? { filename: match[1] || "download", sha256: match[2].toLowerCase() } : { filename, sha256: "" };
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fileSizeFromChunk(chunk) {
  if (chunk.length < 6) return 0;
  return chunk[3]
    | (chunk[2] << 8)
    | (chunk[1] << 16)
    | ((chunk[0] & 0x80) << 17);
}

function sendStats() {
  const elapsedMs = receptionStartedAt ? performance.now() - receptionStartedAt : 0;
  const receivedBytes = expectedSize > 0 ? Math.round(expectedSize * maxProgress) : 0;
  self.postMessage({
    type: "stats", progress: maxProgress, expectedSize, receivedBytes,
    scannedFrames, detectedFrames,
    detectionRate: scannedFrames > 0 ? detectedFrames / scannedFrames : 0,
    elapsedMs,
    speedBytesPerSec: elapsedMs > 0 ? receivedBytes * 1000 / elapsedMs : 0,
  });
}

function resetStats() {
  scannedFrames = 0;
  detectedFrames = 0;
  expectedSize = 0;
  maxProgress = 0;
  receptionStartedAt = 0;
}

function reassemble(id) {
  const expectedSize = Module._cimbard_get_filesize(id);
  const markedFilename = filenameFor(id, expectedSize);
  const chunkSize = Module._cimbard_get_decompress_bufsize();
  const chunk = allocate("decompress", chunkSize);
  const chunks = [];
  let total = 0;
  while (true) {
    const length = Module._cimbard_decompress_read(id, chunk.byteOffset, chunkSize);
    if (length <= 0) break;
    const copy = new Uint8Array(Module.HEAPU8.buffer, chunk.byteOffset, length).slice();
    chunks.push(copy);
    total += copy.length;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.length;
  }
  const { filename, sha256: expectedSha256 } = splitIntegrityMarker(markedFilename);
  sha256Hex(output).then((sha256) => {
    self.postMessage({ type: "complete", filename, file: output.buffer, sha256, verified: expectedSha256 ? sha256 === expectedSha256 : null }, [output.buffer]);
  }).catch(() => {
    self.postMessage({ type: "complete", filename, file: output.buffer, sha256: "", verified: null }, [output.buffer]);
  });
}

function processFrame(message) {
  scannedFrames += 1;
  if (message.mode !== configuredMode) {
    Module._cimbard_configure_decode(message.mode);
    configuredMode = message.mode;
  }
  const pixels = new Uint8Array(message.pixels);
  const image = allocate("image", pixels.length);
  image.set(pixels);
  const fountain = allocate("fountain", Module._cimbard_get_bufsize());
  const length = Module._cimbard_scan_extract_decode(
    image.byteOffset,
    message.width,
    message.height,
    4,
    fountain.byteOffset,
    fountain.length,
  );
  if (length <= 0) {
    self.postMessage({ type: "frame", detected: false });
    sendStats();
    return;
  }

  const decoded = new Uint8Array(Module.HEAPU8.buffer, fountain.byteOffset, length).slice();
  fountain.set(decoded);
  const result = Module._cimbard_fountain_decode(fountain.byteOffset, decoded.length);
  const progress = report();
  if (Array.isArray(progress)) {
    // Count only frames accepted by the fountain sink. A positive image
    // extraction alone can still be a false positive from camera noise.
    if (progress.length > 0) {
      detectedFrames += 1;
      if (!receptionStartedAt) receptionStartedAt = performance.now();
      expectedSize ||= fileSizeFromChunk(decoded);
    }
    maxProgress = Math.max(maxProgress, 0, ...progress.map(Number).filter(Number.isFinite));
  }
  sendStats();
  if (result > 0) {
    const id = typeof result === "bigint" ? Number(result & 0xffffffffn) : Number(result);
    reassemble(id);
  } else {
    self.postMessage({ type: "frame", detected: true });
  }
}

importScripts("cimbar_js.2026-07-13T0523.js");

self.onmessage = (event) => {
  if (!ready) return;
  try {
    if (event.data.type === "reset") resetStats();
    else if (event.data.type === "frame") processFrame(event.data);
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  } finally {
    self.postMessage({ type: "frame-done" });
  }
};
