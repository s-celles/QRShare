/**
 * Shared helper for the asset scripts (generate-icons.ts, generate-screenshots.ts).
 * Drives a headless Chromium through its command line (`--screenshot`), so no
 * browser-automation package is needed. The browser is taken from $CHROME, or
 * else from the Playwright browser cache (~/.cache/ms-playwright), which
 * `bunx playwright install chromium-headless-shell` fills.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

export function findChromium(): string {
  const fromEnv = process.env.CHROME;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`$CHROME points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright");
  const candidates: string[] = [];
  if (existsSync(cache)) {
    // Newest revision first; the headless shell renders exactly the window size.
    const dirs = readdirSync(cache).sort().reverse();
    for (const dir of dirs.filter((d) => d.startsWith("chromium_headless_shell-"))) {
      candidates.push(join(cache, dir, "chrome-headless-shell-linux64", "chrome-headless-shell"));
      candidates.push(join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
      candidates.push(join(cache, dir, "chrome-headless-shell-mac-x64", "chrome-headless-shell"));
    }
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      "No headless Chromium found. Set $CHROME, or run `bunx playwright install chromium-headless-shell`.",
    );
  }
  return found;
}

export interface ScreenshotOptions {
  url: string;
  width: number;
  height: number;
  out: string;
  /** Transparent page background (for icons with rounded corners). */
  transparent?: boolean;
  /** Milliseconds of virtual time to let the page run before the capture. */
  settleMs?: number;
  /** Extra Chromium flags. */
  flags?: string[];
}

/** Captures `url` at exactly `width`×`height` CSS pixels (device scale factor 1). */
export function screenshot(chrome: string, opts: ScreenshotOptions): void {
  const profile = mkdtempSync(join(tmpdir(), "qrshare-chromium-"));
  try {
    const args = [
      chrome,
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--mute-audio",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--window-size=${opts.width},${opts.height}`,
      `--virtual-time-budget=${opts.settleMs ?? 2000}`,
      ...(opts.transparent ? ["--default-background-color=00000000"] : []),
      ...(opts.flags ?? []),
      `--screenshot=${opts.out}`,
      opts.url,
    ];
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0 || !existsSync(opts.out)) {
      throw new Error(`Chromium failed for ${opts.url}:\n${result.stderr.toString()}`);
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Reads the width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
