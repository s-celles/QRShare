/**
 * Author-side attachment preparation (REQ-PASTE-031 to 034), browser glue.
 *
 * PNG, JPEG, WebP and GIF images (detected from their bytes) are decoded with their
 * orientation applied, downscaled to at most 2048 px (then 1600, 1200 if needed to
 * fit 1.5 MiB), re-encoded through a canvas (WebP, else PNG or JPEG; GIF keeps its
 * first frame) and scrubbed of any metadata chunk left. Other files are attached
 * unchanged, with a metadata warning.
 */
import type { PreparedAttachment } from "../board";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "../statement";
import { sanitizeFilename } from "./filename";
import { hasImageMetadata, scrubImageMetadata } from "./metadata";
import { isRaster, sniff, type Sniffed } from "./sniff";

export interface PreparedFile {
  attachment: PreparedAttachment;
  /** Hex SHA-256 of the final bytes (the `attachment:` reference). */
  hash: string;
  kind: "image" | "file";
  /** The image was re-encoded (metadata removed). */
  reencoded: boolean;
  /** Not re-encoded: may carry identifying metadata QRShare does not remove. */
  metadataWarning: boolean;
  originalSize: number;
}

export type PrepareError = "too-large" | "image-failed";

const SIDES = [2048, 1600, 1200];
const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encode(bitmap: ImageBitmap, side: number, fallback: "image/png" | "image/jpeg"): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const toBlob = async (type: string): Promise<Blob> => {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2D context");
      ctx.drawImage(bitmap, 0, 0, width, height);
      return canvas.convertToBlob({ type, quality: 0.85 });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encoding failed"))), type, 0.85));
  };
  let blob = await toBlob("image/webp");
  if (blob.type !== "image/webp") blob = await toBlob(fallback);
  return { blob, width, height };
}

function renamed(name: string, mime: string): string {
  const base = name.replace(/\.[^.]*$/, "") || "image";
  return sanitizeFilename(`${base}.${EXT[mime] ?? "img"}`);
}

export async function prepareAttachment(file: File): Promise<PreparedFile | { error: PrepareError }> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const kind: Sniffed = sniff(head);
  if (isRaster(kind)) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return { error: "image-failed" };
    }
    try {
      const fallback = kind === "jpeg" ? "image/jpeg" : "image/png";
      for (const side of SIDES) {
        const { blob, width, height } = await encode(bitmap, side, fallback);
        const bytes = scrubImageMetadata(new Uint8Array(await blob.arrayBuffer()));
        if (hasImageMetadata(bytes)) return { error: "image-failed" };
        if (bytes.length > MAX_IMAGE_BYTES) continue;
        const mime = blob.type || fallback;
        return {
          attachment: { bytes, mime, name: renamed(file.name, mime), width, height },
          hash: await sha256Hex(bytes),
          kind: "image",
          reencoded: true,
          metadataWarning: false,
          originalSize: file.size,
        };
      }
      return { error: "too-large" };
    } catch {
      return { error: "image-failed" };
    } finally {
      bitmap.close();
    }
  }
  if (file.size > MAX_FILE_BYTES) return { error: "too-large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    attachment: { bytes, mime: file.type || "application/octet-stream", name: sanitizeFilename(file.name), width: 0, height: 0 },
    hash: await sha256Hex(bytes),
    kind: "file",
    reencoded: false,
    metadataWarning: true,
    originalSize: file.size,
  };
}
