import { createAuthor, deriveRoomKeys, type Author, type RoomKeys } from "@/paste/keys";
import type { AttachmentRef, StatementFields } from "@/paste/statement";

export const SECRET = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

let cached: Promise<RoomKeys> | undefined;
export function roomKeys(): Promise<RoomKeys> {
  return (cached ??= deriveRoomKeys(SECRET));
}

export async function attachmentRef(bytes: Uint8Array, over: Partial<AttachmentRef> = {}): Promise<AttachmentRef> {
  return { hash: await sha256(bytes), size: bytes.length, mime: "application/pdf", name: "doc.pdf", width: 0, height: 0, ...over };
}

export async function fields(author: Author, over: Partial<StatementFields> = {}): Promise<StatementFields> {
  return {
    tag: (await roomKeys()).tag,
    author: author.key.publicKey,
    declaredAt: 1_700_000_000_000,
    format: "markdown",
    source: "# Hello\n\nWorld",
    attachments: [],
    ...over,
  };
}

export { createAuthor };
