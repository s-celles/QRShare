/* QRShare worker adapter for the libcimbar decoder API (classic worker). */
"use strict";

let ready = false;
let configuredMode = 0;
const buffers = {};

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

function reassemble(id) {
  const expectedSize = Module._cimbard_get_filesize(id);
  const filename = filenameFor(id, expectedSize);
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
  self.postMessage({ type: "complete", filename, file: output.buffer }, [output.buffer]);
}

function processFrame(message) {
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
    self.postMessage({ type: "frame", detected: length === 0 });
    return;
  }

  const decoded = new Uint8Array(Module.HEAPU8.buffer, fountain.byteOffset, length).slice();
  fountain.set(decoded);
  const result = Module._cimbard_fountain_decode(fountain.byteOffset, decoded.length);
  const progress = report();
  if (Array.isArray(progress)) self.postMessage({ type: "progress", values: progress });
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
    if (event.data.type === "frame") processFrame(event.data);
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  } finally {
    self.postMessage({ type: "frame-done" });
  }
};
