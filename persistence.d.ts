import type * as Y from "yjs";
import type { VersionEntry } from "./versions.js";
export interface PersistenceOptions {
    /** Database name prefix, e.g. "myapp-collab-". */
    prefix: string;
    roomId: string;
}
export interface DocPersistence {
    destroy(): Promise<void>;
    clearData(): Promise<void>;
}
export declare function isPersistenceAvailable(): boolean;
/** Attach y-indexeddb to `doc`; resolves once stored state is loaded (null without IndexedDB). */
export declare function attachDocPersistence({ prefix, roomId }: PersistenceOptions, doc: Y.Doc): Promise<DocPersistence | null>;
/** Store a version entry (idempotent by `id`). */
export declare function saveVersionEntry(opts: PersistenceOptions, entry: VersionEntry): Promise<void>;
/** All stored version entries of a room. */
export declare function loadVersionEntries(opts: PersistenceOptions): Promise<VersionEntry[]>;
