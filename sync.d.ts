import * as Y from "yjs";
import { type CollabRoom } from "./room.js";
import { Emitter } from "./emitter.js";
/** Origin of updates applied from the network: never re-broadcast (no echo loop). */
export declare const REMOTE_ORIGIN: unique symbol;
export interface DocSyncEvents extends Record<string, unknown> {
    /** A peer asked for our state (it joined or reconnected). */
    "sync-request": string;
    /** A remote update was applied to the document. */
    remote: Uint8Array;
    /** Number of connected peers changed. */
    peers: number;
}
/**
 * Keeps any `Y.Doc` in sync with the peers of a room:
 *
 * - `doc-update`: binary update deltas, broadcast on every local change and
 *   applied with {@link REMOTE_ORIGIN} on receipt;
 * - `sync`: state-vector handshake on peer join, so a late joiner (or a peer
 *   back from offline) receives exactly what it misses, in both directions.
 */
export declare class DocSync extends Emitter<DocSyncEvents> {
    readonly doc: Y.Doc;
    private readonly sendUpdate;
    private readonly sendSync;
    private readonly peers;
    private readonly onDocUpdate;
    constructor(room: CollabRoom, doc: Y.Doc);
    get peerCount(): number;
    /** Send our state vector; peers answer with what we miss. */
    handshake(): void;
    private applyRemote;
    destroy(): void;
}
