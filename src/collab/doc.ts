import { signal, type Signal } from "@preact/signals";
import * as Y from "yjs";

/**
 * Origin markers used to distinguish where a Y.Doc update came from.
 *
 * - `REMOTE_ORIGIN`: an update applied via {@link CollabDoc.applyRemote}. Local
 *   update listeners are NOT fired for these, which prevents an echo loop where a
 *   received update would be re-broadcast back to the peer (REQ-COLLAB-012).
 * - `LOCAL_ORIGIN`: a local mutation (typing, restore) that MUST be broadcast.
 */
export const REMOTE_ORIGIN = Symbol("collab-remote");
export const LOCAL_ORIGIN = Symbol("collab-local");

const TEXT_KEY = "content";

/**
 * Wraps a single Yjs `Y.Doc` holding one shared `Y.Text` ("content").
 *
 * The document is transport-agnostic: it produces binary update deltas on local
 * edits (via {@link onUpdate}) and applies remote binary deltas (via
 * {@link applyRemote}). Convergence and concurrent-edit merging are guaranteed by
 * Yjs' CRDT (REQ-COLLAB-010, REQ-COLLAB-013, REQ-COLLAB-014).
 */
export class CollabDoc {
  readonly ydoc: Y.Doc;
  private readonly ytext: Y.Text;
  /** Reactive mirror of the document text for the UI (REQ-COLLAB-015). */
  readonly docText: Signal<string>;
  private readonly listeners = new Set<(update: Uint8Array) => void>();

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.ytext = ydoc.getText(TEXT_KEY);
    this.docText = signal(this.ytext.toString());

    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      // Keep the UI signal in sync regardless of origin.
      this.docText.value = this.ytext.toString();
      // Only broadcast updates that originated locally (not remote-applied ones),
      // so applying a peer's update never bounces back (no echo loop).
      if (origin === REMOTE_ORIGIN) return;
      for (const cb of this.listeners) cb(update);
    });
  }

  /** Current plain-text content of the shared document. */
  get text(): string {
    return this.ytext.toString();
  }

  /** Live character count of the shared document. */
  get length(): number {
    return this.ytext.length;
  }

  /**
   * Register a callback fired with the binary update bytes whenever the document
   * changes due to a local mutation. Returns an unsubscribe function.
   */
  onUpdate(cb: (update: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Replace the entire text with `next` using a minimal prefix/suffix diff so a
   * single-character edit produces a single Yjs insert/delete rather than a full
   * rewrite. This is the v1 `<textarea>` binding (REQ-COLLAB, approved decision 5).
   */
  setText(next: string): void {
    const cur = this.ytext.toString();
    if (cur === next) return;

    let start = 0;
    const minLen = Math.min(cur.length, next.length);
    while (start < minLen && cur[start] === next[start]) start++;

    let endCur = cur.length;
    let endNext = next.length;
    while (
      endCur > start &&
      endNext > start &&
      cur[endCur - 1] === next[endNext - 1]
    ) {
      endCur--;
      endNext--;
    }

    this.ydoc.transact(() => {
      const delCount = endCur - start;
      if (delCount > 0) this.ytext.delete(start, delCount);
      const insertion = next.slice(start, endNext);
      if (insertion.length > 0) this.ytext.insert(start, insertion);
    }, LOCAL_ORIGIN);
  }

  /**
   * Apply a binary update received from a peer. Uses {@link REMOTE_ORIGIN} so the
   * resulting document change is not re-broadcast (REQ-COLLAB-012).
   */
  applyRemote(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
  }

  /** Full snapshot of the current document state (REQ-COLLAB-042). */
  encodeSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Apply a full snapshot to the live document as a LOCAL mutation, so the merge
   * emits an update that is broadcast as a normal doc-update and both peers
   * converge on the restored state (REQ-COLLAB-046).
   */
  applySnapshot(snapshot: Uint8Array): void {
    Y.applyUpdate(this.ydoc, snapshot, LOCAL_ORIGIN);
  }

  /** State vector describing what this document already has (REQ-COLLAB-021). */
  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /**
   * Compute the minimal update needed to bring a peer with the given state vector
   * up to this document's state (REQ-COLLAB-021).
   */
  diffSince(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector);
  }

  destroy(): void {
    this.listeners.clear();
    this.ydoc.destroy();
  }

  /**
   * Extract the plain text stored in a snapshot without mutating any live doc.
   * Used by restore: applying an older snapshot directly to a doc that already has
   * newer state is a no-op in a CRDT (the snapshot is a subset), so restore instead
   * replays the snapshot's text as a forward edit that converges (REQ-COLLAB-046).
   */
  static textFromSnapshot(snapshot: Uint8Array): string {
    const temp = new Y.Doc();
    Y.applyUpdate(temp, snapshot);
    const text = temp.getText(TEXT_KEY).toString();
    temp.destroy();
    return text;
  }
}
