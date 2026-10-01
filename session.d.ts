import * as Y from "yjs";
import type { CollabRoom } from "./room.js";
import { Emitter } from "./emitter.js";
import { DocSync } from "./sync.js";
import { VersionLog, VersionSync, type VersionEntry } from "./versions.js";
import { Presence, type Participant } from "./presence.js";
import type { Identity } from "./identity.js";
import { type PersistenceOptions } from "./persistence.js";
import { type Schema } from "./restore.js";
export interface CollabSessionOptions {
    /** This peer's stable id in the room (trystero `selfId`). */
    siteId: string;
    /** How this participant appears to the others. */
    identity: Identity;
    /** Document to share (a new one by default). */
    doc?: Y.Doc;
    /** Version log to share (a new one by default). */
    versionLog?: VersionLog;
}
export interface CollabSessionEvents extends Record<string, unknown> {
    versions: VersionEntry[];
    participants: Participant[];
    peers: number;
    /** A remote update was applied to the document. */
    remote: Uint8Array;
}
/**
 * A serverless collaboration session: document sync, presence and a shared
 * version history, over one peer-to-peer room. Every participant keeps the full
 * document and history; nothing goes through a server.
 */
export declare class CollabSession extends Emitter<CollabSessionEvents> {
    readonly doc: Y.Doc;
    readonly sync: DocSync;
    readonly versionSync: VersionSync;
    readonly presence: Presence;
    private identity;
    private persistence;
    private unpersist;
    constructor(room: CollabRoom, opts: CollabSessionOptions);
    get versionLog(): VersionLog;
    get versions(): VersionEntry[];
    get participants(): Participant[];
    get peerCount(): number;
    /** Change how this participant appears. */
    setIdentity(identity: Identity): void;
    /** Share where this participant is working (selected cell, caret…). */
    setCursor(cursor: unknown): void;
    /** Ask connected peers for what we miss (after attaching to an existing room). */
    handshake(): void;
    /** Save the current document as a named version, shared with everyone. */
    saveVersion(label: string, opts?: {
        auto?: boolean;
    }): VersionEntry;
    /** A standalone document holding a saved version (null if unknown); destroy it after use. */
    versionDoc(id: string): Y.Doc | null;
    /** Bring the document back to a saved version, as a new edit that reaches everyone. */
    restoreVersion(id: string, schema: Schema): boolean;
    /**
     * Keep the document and history in IndexedDB so a reload restores them.
     * Stored history is merged into the log; later entries are stored as they come.
     */
    persist(opts: PersistenceOptions): Promise<void>;
    destroy(): void;
}
