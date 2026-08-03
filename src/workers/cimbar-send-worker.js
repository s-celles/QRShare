/* QRShare worker adapter for the libcimbar encoder API (classic worker). */
"use strict";

self.window = self;
self.window.matchMedia ||= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
self.document = {
  fullscreenElement: null,
  getElementById() { return null; },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: "visible",
  hidden: false,
};

let ready = false;
let rendering = false;

var Module = {
  preRun: [],
  onRuntimeInitialized() {
    ready = true;
    try {
      Send.init_window(Module.canvas);
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
  },
};

var Report = {
  prevent_sleep() { self.postMessage({ type: "wake-lock" }); },
  setAspectRatio(value) { self.postMessage({ type: "aspect", value }); },
  setActive() { self.postMessage({ type: "active" }); },
  setHTML() {},
  setTitle(filename) { self.postMessage({ type: "filename", filename }); },
};

importScripts("send.2026-07-13T0523.js");

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fileWithIntegrityMarker(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  // libcimbar exposes the filename but has no application-level hash field.
  // Carry the expected digest in a reversible filename suffix.
  return new File([bytes], `${file.name}.qrshare-sha256-${hex(digest)}`, { type: file.type });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      Module.canvas = message.canvas;
      importScripts("cimbar_js.2026-07-13T0523.js");
      return;
    }
    if (!ready) throw new Error("libcimbar is not ready");
    if (message.type === "start") {
      Send.setMode(message.mode);
      Send.setFPS(message.fps);
      const markedFile = await fileWithIntegrityMarker(message.file);
      Send.importFile(markedFile);
      if (!rendering) {
        rendering = true;
        Send.nextFrame();
      }
    } else if (message.type === "fps") {
      Send.setFPS(message.fps);
    } else if (message.type === "mode") {
      Send.setMode(message.mode);
    } else if (message.type === "pause") {
      Send.togglePause(message.paused);
    } else if (message.type === "rotate") {
      Send.rotate_window(message.rotated);
    }
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
