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

export const pendingFile = signal<{
  buffer: ArrayBuffer;
  filename: string;
  isText?: boolean;
} | null>(null);

export const pendingText = signal<string | null>(null);
