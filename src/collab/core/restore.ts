import * as Y from "yjs";

/** Kind of each top-level shared type an app stores in its document. */
export type Schema = Record<string, "text" | "map" | "array">;

/** Replace the content of `text` with `next` through a minimal prefix/suffix edit. */
export function setText(text: Y.Text, next: string, origin?: unknown): void {
  const cur = text.toString();
  if (cur === next) return;
  let start = 0;
  const min = Math.min(cur.length, next.length);
  while (start < min && cur[start] === next[start]) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
    endCur--;
    endNext--;
  }
  text.doc!.transact(() => {
    if (endCur > start) text.delete(start, endCur - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  }, origin);
}

/** A read-only document holding a snapshot (`Y.encodeStateAsUpdate`). */
export function docFromSnapshot(snapshot: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  return doc;
}

/**
 * Bring the live document back to the content of `source` as a new, ordinary
 * edit — so it syncs to everyone and can itself be undone by restoring a later
 * version. Applying an old snapshot directly would be a no-op (CRDT updates
 * only ever add history). Map and array values are copied as JSON.
 */
export function restoreShared(target: Y.Doc, source: Y.Doc, schema: Schema, origin?: unknown): void {
  target.transact(() => {
    for (const [name, kind] of Object.entries(schema)) {
      if (kind === "text") {
        setText(target.getText(name), source.getText(name).toString());
      } else if (kind === "map") {
        const to = target.getMap(name);
        const from = source.getMap(name).toJSON() as Record<string, unknown>;
        for (const key of [...to.keys()]) if (!(key in from)) to.delete(key);
        for (const [key, value] of Object.entries(from)) {
          if (JSON.stringify(to.get(key) instanceof Y.AbstractType ? (to.get(key) as Y.AbstractType<unknown>).toJSON() : to.get(key)) !== JSON.stringify(value)) to.set(key, value);
        }
      } else {
        const to = target.getArray(name);
        const from = source.getArray(name).toJSON();
        if (JSON.stringify(to.toJSON()) === JSON.stringify(from)) continue;
        to.delete(0, to.length);
        to.insert(0, from);
      }
    }
  }, origin);
}
