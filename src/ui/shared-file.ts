import { signal } from "@preact/signals";

export const pendingFile = signal<{
  buffer: ArrayBuffer;
  filename: string;
} | null>(null);
