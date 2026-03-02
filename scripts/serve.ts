import { join } from "path";

const distDir = join(import.meta.dir, "..", "dist");
const port = Number(process.env.PORT) || 3000;

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = join(distDir, pathname);

    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = pathname.slice(pathname.lastIndexOf("."));
      return new Response(file, {
        headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
      });
    }

    // SPA fallback
    return new Response(Bun.file(join(distDir, "index.html")), {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Serving dist/ at http://localhost:${port}`);
