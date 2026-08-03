import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "../..");
const VENDOR = join(ROOT, "vendor/libcimbar");

describe("experimental libcimbar integration", () => {
  it("vendors the pinned web runtime and its MPL license", () => {
    for (const file of [
      "cimbar_js.2026-07-13T0523.js",
      "cimbar_js.2026-07-13T0523.wasm",
      "send.2026-07-13T0523.js",
      "LICENSE",
    ]) {
      expect(existsSync(join(VENDOR, file))).toBe(true);
    }
    expect(readFileSync(join(VENDOR, "LICENSE"), "utf8"))
      .toContain("Mozilla Public License Version 2.0");
  });

  it("uses QRShare-owned workers instead of embedding upstream pages", () => {
    expect(existsSync(join(VENDOR, "index.html"))).toBe(false);
    expect(existsSync(join(VENDOR, "recv.html"))).toBe(false);
    expect(existsSync(join(ROOT, "src/workers/cimbar-send-worker.js"))).toBe(true);
    expect(existsSync(join(ROOT, "src/workers/cimbar-receive-worker.js"))).toBe(true);
  });
});
