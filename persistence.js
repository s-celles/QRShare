/**
 * Local persistence of a collaborative session in IndexedDB, so a reload
 * restores the document and the version history. Every participant keeps its
 * own copy (there is no server). Degrades to a no-op without IndexedDB.
 *
 * Databases are named `<prefix>doc-<room>` (the live `Y.Doc`, via y-indexeddb)
 * and `<prefix>log-<room>` (the version log).
 */
const LOG_STORE = "versions";
export function isPersistenceAvailable() {
    return typeof indexedDB !== "undefined";
}
/** Attach y-indexeddb to `doc`; resolves once stored state is loaded (null without IndexedDB). */
export async function attachDocPersistence({ prefix, roomId }, doc) {
    if (!isPersistenceAvailable())
        return null;
    const { IndexeddbPersistence } = await import("y-indexeddb");
    const provider = new IndexeddbPersistence(`${prefix}doc-${roomId}`, doc);
    await provider.whenSynced;
    return provider;
}
function openLogDb({ prefix, roomId }) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(`${prefix}log-${roomId}`, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(LOG_STORE))
                req.result.createObjectStore(LOG_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
/** Store a version entry (idempotent by `id`). */
export async function saveVersionEntry(opts, entry) {
    if (!isPersistenceAvailable())
        return;
    const db = await openLogDb(opts);
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(LOG_STORE, "readwrite");
            tx.objectStore(LOG_STORE).put(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    finally {
        db.close();
    }
}
/** All stored version entries of a room. */
export async function loadVersionEntries(opts) {
    if (!isPersistenceAvailable())
        return [];
    const db = await openLogDb(opts);
    try {
        return await new Promise((resolve, reject) => {
            const req = db.transaction(LOG_STORE, "readonly").objectStore(LOG_STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    finally {
        db.close();
    }
}
