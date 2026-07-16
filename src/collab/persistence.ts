import { IndexeddbPersistence } from "y-indexeddb";
import type { CollabDoc } from "./doc";
import type { VersionEntry } from "./versionLog";

/**
 * Local persistence for a collaborative session, keyed by `roomId`, so a page
 * reload can restore the in-progress document and version log
 * (REQ-COLLAB-060..062).
 *
 * The live `Y.Doc` is persisted via the `y-indexeddb` provider; the version log is
 * stored in a small companion object store (its snapshots and Lamport metadata are
 * not part of the Y.Doc). Everything degrades gracefully to a no-op when IndexedDB
 * is unavailable (e.g. server-side rendering or a test runtime).
 */

const DOC_DB_PREFIX = "qrshare-collab-doc-";
const LOG_DB_PREFIX = "qrshare-collab-log-";
const LOG_STORE = "versions";

/** Whether IndexedDB is available in the current runtime. */
export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Attach IndexedDB persistence to a document. Resolves once the persisted state
 * has been loaded into the doc, or to `null` if IndexedDB is unavailable.
 */
export async function attachDocPersistence(
  roomId: string,
  doc: CollabDoc,
): Promise<IndexeddbPersistence | null> {
  if (!isPersistenceAvailable()) return null;
  const provider = new IndexeddbPersistence(`${DOC_DB_PREFIX}${roomId}`, doc.ydoc);
  await provider.whenSynced;
  return provider;
}

function openLogDb(roomId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`${LOG_DB_PREFIX}${roomId}`, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist a single version-log entry (idempotent by `id`). */
export async function saveVersionEntry(
  roomId: string,
  entry: VersionEntry,
): Promise<void> {
  if (!isPersistenceAvailable()) return;
  const db = await openLogDb(roomId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_STORE, "readwrite");
    tx.objectStore(LOG_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Load all persisted version-log entries for a room. */
export async function loadVersionEntries(roomId: string): Promise<VersionEntry[]> {
  if (!isPersistenceAvailable()) return [];
  const db = await openLogDb(roomId);
  const entries = await new Promise<VersionEntry[]>((resolve, reject) => {
    const tx = db.transaction(LOG_STORE, "readonly");
    const req = tx.objectStore(LOG_STORE).getAll();
    req.onsuccess = () => resolve(req.result as VersionEntry[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return entries;
}
