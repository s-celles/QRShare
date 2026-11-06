/**
 * How an attachment is shown is decided from its bytes only, never from the
 * declared MIME type or the name (REQ-PASTE-039). Patterns follow the WHATWG MIME
 * sniffing standard; SVG, HTML and everything else are "other" (download only).
 */

export type Sniffed = "png" | "jpeg" | "webp" | "gif" | "mp3" | "ogg" | "wav" | "webm" | "mp4" | "other";

const ascii = (bytes: Uint8Array, at: number, text: string) => {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

export function sniff(bytes: Uint8Array): Sniffed {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "gif";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBPVP")) return "webp";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "wav";
  if (ascii(bytes, 0, "ID3")) return "mp3";
  // MPEG audio frame sync: 11 set bits, a valid version and a layer other than "reserved"
  if (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0) return "mp3";
  if (ascii(bytes, 0, "OggS\0")) return "ogg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (ascii(bytes, 4, "ftyp")) return "mp4";
  return "other";
}

export function isRaster(kind: Sniffed): boolean {
  return kind === "png" || kind === "jpeg" || kind === "webp" || kind === "gif";
}

export function isMedia(kind: Sniffed): "audio" | "video" | null {
  if (kind === "mp3" || kind === "ogg" || kind === "wav") return "audio";
  if (kind === "webm" || kind === "mp4") return "video";
  return null;
}

const MIME: Record<Sniffed, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
  mp4: "video/mp4",
  other: "application/octet-stream",
};

/** The MIME type of the `blob:` URL used to show a sniffed attachment. */
export function sniffedMime(kind: Sniffed): string {
  return MIME[kind];
}
