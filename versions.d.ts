import { type CollabRoom } from "./room.js";
import { Emitter } from "./emitter.js";
/**
 * A saved, labelled snapshot of the shared document.
 *
 * Entries are ordered by `(lamport, siteId)` — a per-peer logical clock with the
 * site id as tie-breaker — never by wall-clock time, which is unsafe across
 * unsynchronized devices. `author` and `savedAt` are informative only.
 */
export interface VersionEntry {
    /** Stable UUID, identical across peers, used for de-duplication. */
    id: string;
    label: string;
    /** Full `Y.encodeStateAsUpdate` snapshot of the document at save time. */
    snapshotBytes: Uint8Array;
    /** The saving peer's site id. */
    siteId: string;
    /** Per-peer logical clock value. */
    lamport: number;
    /** Display name of the person who saved it. */
    author?: string;
    /** Wall-clock time of the save (ms since epoch), for display. */
    savedAt?: number;
    /** Saved automatically rather than by a person. */
    auto?: boolean;
}
/**
 * Append-only, convergent log of named document versions with a Lamport clock.
 * Entries are de-duplicated by `id`, so replays during resync never duplicate.
 */
export declare class VersionLog {
    private readonly siteId;
    private readonly items;
    private _lamport;
    constructor(siteId: string);
    get lamport(): number;
    entries(): VersionEntry[];
    save(label: string, snapshotBytes: Uint8Array, meta?: Pick<VersionEntry, "author" | "auto">): VersionEntry;
    /** Merge an entry from a peer (or from storage); returns false if already known. */
    receive(entry: VersionEntry): boolean;
    restore(id: string): Uint8Array | null;
    get(id: string): VersionEntry | undefined;
    has(id: string): boolean;
}
/**
 * Binary frame for a {@link VersionEntry}: a 4-byte big-endian header length, a
 * JSON metadata header, then the raw snapshot bytes. Unknown header fields are
 * ignored by older readers, so new metadata stays compatible.
 */
export declare function encodeVersionEntry(entry: VersionEntry): ArrayBuffer;
export declare function decodeVersionEntry(buffer: ArrayBuffer): VersionEntry;
export interface VersionSyncEvents extends Record<string, unknown> {
    /** The list changed (local save or entry received). */
    change: VersionEntry[];
    /** A new entry arrived from a peer. */
    received: VersionEntry;
}
/** Shares a {@link VersionLog} with the peers of a room over the `version` action. */
export declare class VersionSync extends Emitter<VersionSyncEvents> {
    readonly log: VersionLog;
    private readonly send;
    constructor(room: CollabRoom, log: VersionLog);
    /** Save a version locally and share it. */
    save(label: string, snapshotBytes: Uint8Array, meta?: Pick<VersionEntry, "author" | "auto">): VersionEntry;
    /** Send the whole log (to a peer that just synced). */
    replay(): void;
}
