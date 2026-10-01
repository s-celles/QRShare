import type { CollabDoc } from "./doc";
import * as core from "./core/persistence";
import type { VersionEntry } from "./core/versions";

/**
 * Local persistence for a collaborative session, keyed by `roomId`, so a page
 * reload can restore the in-progress document and version log
 * (REQ-COLLAB-060..062). Thin wrapper over the shared collaboration core with
 * QRShare's database names (`qrshare-collab-doc-…`, `qrshare-collab-log-…`).
 */

const PREFIX = "qrshare-collab-";
const where = (roomId: string): core.PersistenceOptions => ({ prefix: PREFIX, roomId });

export const isPersistenceAvailable = core.isPersistenceAvailable;

/** Attach IndexedDB persistence to a document (null without IndexedDB). */
export function attachDocPersistence(roomId: string, doc: CollabDoc): Promise<core.DocPersistence | null> {
  return core.attachDocPersistence(where(roomId), doc.ydoc);
}

/** Persist a single version-log entry (idempotent by `id`). */
export function saveVersionEntry(roomId: string, entry: VersionEntry): Promise<void> {
  return core.saveVersionEntry(where(roomId), entry);
}

/** Load all persisted version-log entries for a room. */
export function loadVersionEntries(roomId: string): Promise<VersionEntry[]> {
  return core.loadVersionEntries(where(roomId));
}
