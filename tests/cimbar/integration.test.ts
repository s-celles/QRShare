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
      "index.html",
      "recv.html",
      "recv-worker.2026-07-13T0523.js",
      "LICENSE",
    ]) {
      expect(existsSync(join(VENDOR, file))).toBe(true);
    }
    expect(readFileSync(join(VENDOR, "LICENSE"), "utf8"))
      .toContain("Mozilla Public License Version 2.0");
  });

  it("keeps nested service workers disabled under the QRShare service worker", () => {
    expect(readFileSync(join(VENDOR, "index.html"), "utf8"))
      .not.toContain("serviceWorker.register");
    expect(readFileSync(join(VENDOR, "recv.html"), "utf8"))
      .not.toContain("serviceWorker.register");
  });
});
