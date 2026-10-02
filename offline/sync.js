/**
 * Offline sync of a Yjs document in passes: one device shows its state
 * vector, the other answers with only the updates the first one lacks, which
 * are applied to an isolated copy and validated before touching the document.
 */
import * as Y from "yjs";
import { FrameError } from "./frame.js";
export const OFFLINE_ORIGIN = "offline-sync";
export const stateVector = (doc) => Y.encodeStateVector(doc);
/** The updates `doc` has and the holder of `peerStateVector` lacks (empty-ish when nothing). */
export function updateFor(doc, peerStateVector) {
    try {
        return Y.encodeStateAsUpdate(doc, peerStateVector);
    }
    catch {
        throw new FrameError("invalid", "The state vector could not be read");
    }
}
/** The whole document, for local storage or a first transfer. */
export const snapshot = (doc) => Y.encodeStateAsUpdate(doc);
export function loadDoc(bytes, guid) {
    const doc = new Y.Doc(guid ? { guid } : undefined);
    try {
        Y.applyUpdate(doc, bytes);
    }
    catch {
        throw new FrameError("invalid", "The stored document could not be read");
    }
    return doc;
}
/** What an update contains, to show before applying it. */
export function summarize(update) {
    let decoded;
    try {
        decoded = Y.decodeUpdate(update);
    }
    catch {
        throw new FrameError("invalid", "The update could not be read");
    }
    const clients = new Set();
    let insertions = 0;
    for (const s of decoded.structs) {
        if (s instanceof Y.Skip)
            continue;
        clients.add(s.id.client);
        insertions += s.length;
    }
    let deletions = 0;
    for (const [client, ranges] of decoded.ds.clients) {
        deletions += ranges.length;
        clients.add(client);
    }
    return { bytes: update.length, insertions, deletions, clients: [...clients] };
}
/**
 * Apply `update` to an isolated copy, run `validate` on it, and only then to
 * `doc`. Applying the same update again changes nothing.
 */
export function applyValidated(doc, update, validate = () => { }) {
    const summary = summarize(update);
    const before = Y.encodeStateVector(doc);
    const deletedBefore = deletedCount(doc);
    const copy = new Y.Doc({ guid: doc.guid });
    try {
        Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
        Y.applyUpdate(copy, update);
    }
    catch {
        copy.destroy();
        throw new FrameError("invalid", "The update could not be applied");
    }
    try {
        validate(copy);
    }
    catch (err) {
        throw err instanceof FrameError ? err : new FrameError("invalid", `The update was refused: ${err.message}`);
    }
    finally {
        copy.destroy();
    }
    Y.applyUpdate(doc, update, OFFLINE_ORIGIN);
    return { changed: !sameBytes(before, Y.encodeStateVector(doc)) || deletedCount(doc) !== deletedBefore, summary };
}
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Number of deleted items, to notice an update that only deletes. */
function deletedCount(doc) {
    let n = 0;
    for (const ranges of Y.createDeleteSetFromStructStore(doc.store).clients.values())
        for (const r of ranges)
            n += r.len;
    return n;
}
