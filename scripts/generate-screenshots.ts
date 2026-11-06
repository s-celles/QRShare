#!/usr/bin/env bun
/**
 * Captures the store screenshots referenced by manifest.webmanifest
 * (assets/screenshots/*.png) from the built app in dist/.
 *
 * It serves dist/ on a local port, starts a headless Chromium (see
 * scripts/chromium.ts) and drives it through the Chrome DevTools Protocol with
 * Bun's built-in WebSocket, so no browser-automation package is needed.
 * The PNGs are committed; run this again when the UI changes noticeably:
 *   bun run build && bun run screenshots
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findChromium, pngSize } from "./chromium";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "assets", "screenshots");

interface Shot {
  file: string;
  width: number;
  height: number;
  mobile: boolean;
  route: string;
  /** Script run in the page after it loaded (e.g. to start a transfer). */
  action?: string;
}

const SAMPLE_TEXT =
  "QRShare sends files and text between devices with animated QR codes: no network, no account, nothing leaves the screen.";

/** Clicks the "Send as QR" button once the shared text has filled the text area. */
const START_QR = `(() => { const b = document.querySelector("button.start-btn"); if (b && !b.disabled) b.click(); return !!b; })()`;

const SHOTS: Shot[] = [
  { file: "home-wide.png", width: 1280, height: 800, mobile: false, route: "#/" },
  {
    file: "send-qr-wide.png",
    width: 1280,
    height: 800,
    mobile: false,
    route: `#/send/qr?text=${encodeURIComponent(SAMPLE_TEXT)}`,
    action: START_QR,
  },
  { file: "home-narrow.png", width: 540, height: 1200, mobile: true, route: "#/" },
  {
    file: "send-qr-narrow.png",
    width: 540,
    height: 1200,
    mobile: true,
    route: `#/send/qr?text=${encodeURIComponent(SAMPLE_TEXT)}`,
    action: START_QR,
  },
];

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

/** Minimal CDP client over one page's WebSocket. */
class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      const waiter = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else waiter.resolve(msg.result);
    });
  }

  static open(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error(`Cannot connect to ${url}`)));
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch {
      // not ready yet
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("Error: dist/ not found. Run `bun run build` first.");
    process.exit(1);
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url).pathname;
      const pathname = url.endsWith("/") ? `${url}index.html` : url;
      const file = Bun.file(join(DIST, pathname));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      const ext = pathname.slice(pathname.lastIndexOf("."));
      return new Response(file, { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
    },
  });

  const chrome = findChromium();
  const profile = mkdtempSync(join(tmpdir(), "qrshare-shots-"));
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const browser = Bun.spawn(
    [
      chrome,
      "--headless",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--mute-audio",
      "--lang=en-US",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );

  try {
    console.log(`Capturing screenshots with ${chrome}`);
    const wsUrl = await waitFor("the DevTools endpoint", async () => {
      const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      return targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    });
    const cdp = await Cdp.open(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await cdp.send("Emulation.setLocaleOverride", { locale: "en-US" });

    mkdirSync(OUT, { recursive: true });
    const base = `http://127.0.0.1:${server.port}/`;
    for (const shot of SHOTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: 1,
        mobile: shot.mobile,
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: shot.mobile });
      // Load a blank page first so a hash-only change still re-runs the app from scratch.
      await cdp.send("Page.navigate", { url: "about:blank" });
      await sleep(200);
      const nav = await cdp.send("Page.navigate", { url: base + shot.route });
      if (nav.errorText) throw new Error(`Cannot load ${base + shot.route}: ${nav.errorText}`);
      await waitFor("the app to render", async () => {
        const r = await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector("#app main, #app header") ? true : undefined`,
          returnByValue: true,
        });
        return r.result?.value === true ? true : undefined;
      });
      await sleep(1000);
      if (shot.action) {
        await cdp.send("Runtime.evaluate", { expression: shot.action, returnByValue: true });
        await sleep(2500);
      }
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const out = join(OUT, shot.file);
      writeFileSync(out, Buffer.from(data, "base64"));
      const size = pngSize(readFileSync(out));
      if (size.width !== shot.width || size.height !== shot.height) {
        throw new Error(`${shot.file}: expected ${shot.width}x${shot.height}, got ${size.width}x${size.height}`);
      }
      console.log(`  assets/screenshots/${shot.file} (${size.width}x${size.height})`);
    }
    cdp.close();
  } finally {
    browser.kill();
    await browser.exited;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
