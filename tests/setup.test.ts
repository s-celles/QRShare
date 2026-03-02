import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

describe("project scaffolding", () => {
  it("has package.json with correct metadata", async () => {
    const pkg = await Bun.file(resolve(root, "package.json")).json();
    expect(pkg.name).toBe("qrshare");
    expect(pkg.license).toBe("GPL-3.0-or-later");
    expect(pkg.type).toBe("module");
  });

  it("has required scripts defined", async () => {
    const pkg = await Bun.file(resolve(root, "package.json")).json();
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.package).toBeDefined();
    expect(pkg.scripts.typecheck).toBeDefined();
  });

  it("has core dependencies", async () => {
    const pkg = await Bun.file(resolve(root, "package.json")).json();
    expect(pkg.dependencies["preact"]).toBeDefined();
    expect(pkg.dependencies["@preact/signals"]).toBeDefined();
    expect(pkg.dependencies["lean-qr"]).toBeDefined();
    expect(pkg.dependencies["fflate"]).toBeDefined();
    expect(pkg.dependencies["peerjs"]).toBeDefined();
  });

  it("has tsconfig.json with strict mode", async () => {
    const tsconfig = await Bun.file(resolve(root, "tsconfig.json")).json();
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("preact");
  });

  it("has the required source directories", () => {
    const dirs = [
      "src/ui", "src/codec", "src/qr", "src/protocol",
      "src/compression", "src/crypto", "src/webrtc",
      "src/workers", "src/share",
    ];
    for (const dir of dirs) {
      expect(existsSync(resolve(root, dir))).toBe(true);
    }
  });

  it("has index.html with required meta tags", async () => {
    const html = await Bun.file(resolve(root, "index.html")).text();
    expect(html).toContain('viewport');
    expect(html).toContain('theme-color');
    expect(html).toContain('manifest.webmanifest');
    expect(html).toContain('<div id="app">');
  });

  it("can import core dependencies without errors", async () => {
    const { deflateSync, inflateSync } = await import("fflate");
    expect(typeof deflateSync).toBe("function");
    expect(typeof inflateSync).toBe("function");
  });
});
