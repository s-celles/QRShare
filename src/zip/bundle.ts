import { zipSync, unzipSync } from "fflate";
import type { Zippable } from "fflate";

export interface FileEntry {
  name: string;
  data: Uint8Array;
}

const BUNDLE_SUFFIX = ".qrshare-bundle.zip";

export function bundleFiles(files: FileEntry[]): Uint8Array {
  const zippable: Zippable = {};
  for (const f of files) {
    zippable[f.name] = f.data;
  }
  return zipSync(zippable);
}

/**
 * Conservative upper bound of `bundleFiles()` output, from names and sizes only
 * (no need to read or compress the files): per entry a local header (30 B) and a
 * central-directory record (46 B), each with the UTF-8 name, a small slack for extra
 * fields, and the worst-case deflate expansion of stored blocks (5 B per 64 KiB block
 * plus an end block); then the 22-byte end-of-central-directory record.
 */
export function bundleSizeUpperBound(files: ReadonlyArray<{ name: string; size: number }>): number {
  const encoder = new TextEncoder();
  let total = 22;
  for (const f of files) {
    const name = encoder.encode(f.name).length;
    total += 30 + 46 + 2 * name + 32 + f.size + 5 * Math.ceil(f.size / 65535) + 5;
  }
  return total;
}

export function unbundleFiles(zipData: Uint8Array): FileEntry[] {
  const unzipped = unzipSync(zipData);
  return Object.entries(unzipped).map(([name, data]) => ({ name, data }));
}

export function isZipBundle(filename: string): boolean {
  return filename.endsWith(BUNDLE_SUFFIX);
}

export function makeBundleName(fileCount: number): string {
  return `qrshare-${fileCount}-files${BUNDLE_SUFFIX}`;
}
