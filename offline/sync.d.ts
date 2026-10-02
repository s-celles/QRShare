/**
 * Offline sync of a Yjs document in passes: one device shows its state
 * vector, the other answers with only the updates the first one lacks, which
 * are applied to an isolated copy and validated before touching the document.
 */
import * as Y from "yjs";
export declare const OFFLINE_ORIGIN = "offline-sync";
export declare const stateVector: (doc: Y.Doc) => Uint8Array;
/** The updates `doc` has and the holder of `peerStateVector` lacks (empty-ish when nothing). */
export declare function updateFor(doc: Y.Doc, peerStateVector: Uint8Array): Uint8Array;
/** The whole document, for local storage or a first transfer. */
export declare const snapshot: (doc: Y.Doc) => Uint8Array;
export declare function loadDoc(bytes: Uint8Array, guid?: string): Y.Doc;
export interface UpdateSummary {
    bytes: number;
    /** Inserted items (characters, elements, entries). */
    insertions: number;
    /** Deleted ranges. */
    deletions: number;
    /** Yjs client ids of the authors of the changes. */
    clients: number[];
}
/** What an update contains, to show before applying it. */
export declare function summarize(update: Uint8Array): UpdateSummary;
export interface ApplyResult {
    /** False when the document already had everything (replayed update). */
    changed: boolean;
    summary: UpdateSummary;
}
/**
 * Apply `update` to an isolated copy, run `validate` on it, and only then to
 * `doc`. Applying the same update again changes nothing.
 */
export declare function applyValidated(doc: Y.Doc, update: Uint8Array, validate?: (copy: Y.Doc) => void): ApplyResult;
