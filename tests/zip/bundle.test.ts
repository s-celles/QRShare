import { describe, expect, it } from "bun:test";
import {
  bundleFiles,
  bundleSizeUpperBound,
  unbundleFiles,
  isZipBundle,
  makeBundleName,
  type FileEntry,
} from "@/zip/bundle";

describe("zip bundle utility", () => {
  it("round-trips multiple files", () => {
    const files: FileEntry[] = [
      { name: "hello.txt", data: new TextEncoder().encode("Hello World") },
      { name: "data.bin", data: new Uint8Array([1, 2, 3, 4, 5]) },
    ];

    const zipped = bundleFiles(files);
    expect(zipped).toBeInstanceOf(Uint8Array);
    expect(zipped.length).toBeGreaterThan(0);

    const extracted = unbundleFiles(zipped);
    expect(extracted).toHaveLength(2);

    const hello = extracted.find((f) => f.name === "hello.txt");
    const data = extracted.find((f) => f.name === "data.bin");

    expect(hello).toBeDefined();
    expect(new TextDecoder().decode(hello!.data)).toBe("Hello World");

    expect(data).toBeDefined();
    expect(Array.from(data!.data)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles a single file", () => {
    const files: FileEntry[] = [
      { name: "only.txt", data: new TextEncoder().encode("solo") },
    ];

    const zipped = bundleFiles(files);
    const extracted = unbundleFiles(zipped);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].name).toBe("only.txt");
    expect(new TextDecoder().decode(extracted[0].data)).toBe("solo");
  });

  it("handles empty file content", () => {
    const files: FileEntry[] = [
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "nonempty.txt", data: new TextEncoder().encode("content") },
    ];

    const zipped = bundleFiles(files);
    const extracted = unbundleFiles(zipped);
    expect(extracted).toHaveLength(2);

    const empty = extracted.find((f) => f.name === "empty.txt");
    expect(empty).toBeDefined();
    expect(empty!.data.length).toBe(0);
  });

  it("preserves unicode filenames", () => {
    const files: FileEntry[] = [
      { name: "café.txt", data: new TextEncoder().encode("bonjour") },
      { name: "日本語.txt", data: new TextEncoder().encode("hello") },
    ];

    const zipped = bundleFiles(files);
    const extracted = unbundleFiles(zipped);
    expect(extracted).toHaveLength(2);
    expect(extracted.map((f) => f.name).sort()).toEqual(
      ["café.txt", "日本語.txt"].sort(),
    );
  });

  it("isZipBundle detects bundle filenames", () => {
    expect(isZipBundle("qrshare-3-files.qrshare-bundle.zip")).toBe(true);
    expect(isZipBundle("something.qrshare-bundle.zip")).toBe(true);
    expect(isZipBundle("photo.zip")).toBe(false);
    expect(isZipBundle("document.pdf")).toBe(false);
    expect(isZipBundle("")).toBe(false);
  });

  it("makeBundleName generates correct format", () => {
    expect(makeBundleName(3)).toBe("qrshare-3-files.qrshare-bundle.zip");
    expect(makeBundleName(1)).toBe("qrshare-1-files.qrshare-bundle.zip");
    expect(isZipBundle(makeBundleName(5))).toBe(true);
  });
});


describe("bundleSizeUpperBound (review item 9)", () => {
  it("is never below the real archive size, even for incompressible data", () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 40; trial++) {
      const count = 1 + Math.floor(rand() * 5);
      const entries = Array.from({ length: count }, (_, i) => {
        const size = Math.floor(rand() * (trial < 30 ? 9000 : 150000));
        const data = new Uint8Array(size);
        for (let j = 0; j < size; j += 65536) crypto.getRandomValues(data.subarray(j, Math.min(size, j + 65536)));
        return { name: `fichier-é-${trial}-${i}.bin`, data };
      });
      const real = bundleFiles(entries).length;
      const bound = bundleSizeUpperBound(entries.map((e) => ({ name: e.name, size: e.data.length })));
      expect(bound).toBeGreaterThanOrEqual(real);
      expect(bound - real).toBeLessThan(200 * count);
    }
  });
});
