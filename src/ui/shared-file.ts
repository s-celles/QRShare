import { signal } from "@preact/signals";

export type TextContent = {
  kind: "text";
  text: string;
};

export type FileContent = {
  kind: "file";
  file: File;
};

export type ShareableContent = TextContent | FileContent;

export const TEXT_FILENAME = "message.txt";
export const TEXT_MIME_TYPE = "text/plain; charset=utf-8";

export function textToBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/");
}

export interface PendingFile {
  buffer: ArrayBuffer;
  filename: string;
  isText?: boolean;
  /** MIME type of the file, when the view that hands it over knows it. */
  mimeType?: string;
}

export const pendingFile = signal<PendingFile | null>(null);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  vcf: "text/vcard",
};

/** The MIME type of a handed-over file: its own, else text for text, else from its extension (REQ-RTC-004). */
export function pendingFileMimeType(file: PendingFile): string {
  if (file.mimeType) return file.mimeType;
  if (file.isText) return "text/plain; charset=utf-8";
  const extension = file.filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export const pendingText = signal<string | null>(null);
