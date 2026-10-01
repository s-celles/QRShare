import * as Y from "yjs";
/** Kind of each top-level shared type an app stores in its document. */
export type Schema = Record<string, "text" | "map" | "array">;
/** Replace the content of `text` with `next` through a minimal prefix/suffix edit. */
export declare function setText(text: Y.Text, next: string, origin?: unknown): void;
/** A read-only document holding a snapshot (`Y.encodeStateAsUpdate`). */
export declare function docFromSnapshot(snapshot: Uint8Array): Y.Doc;
/**
 * Bring the live document back to the content of `source` as a new, ordinary
 * edit — so it syncs to everyone and can itself be undone by restoring a later
 * version. Applying an old snapshot directly would be a no-op (CRDT updates
 * only ever add history). Map and array values are copied as JSON.
 */
export declare function restoreShared(target: Y.Doc, source: Y.Doc, schema: Schema, origin?: unknown): void;
