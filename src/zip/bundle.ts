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
