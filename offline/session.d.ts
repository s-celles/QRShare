/**
 * One device's side of an offline sync: makes the frames to show and
 * handles the frames scanned from the other device.
 */
import * as Y from "yjs";
import { type PeerKey, type PeerStore, type TrustedPeer } from "./peers.js";
import { type UpdateSummary } from "./sync.js";
import type { ImportLog } from "./log.js";
export interface OfflineSyncOptions {
    doc: Y.Doc;
    /** UUID of the shared document. */
    docId: string;
    key: PeerKey;
    name: string;
    peers: PeerStore;
    log: ImportLog;
    /** Checks the document after an update, on an isolated copy; throws to refuse it. */
    validate?: (copy: Y.Doc) => void;
    maxBytes?: number;
}
/** What a scanned frame asks for, before anything is applied. */
export type Received = {
    type: "hello";
    peer: TrustedPeer;
    known: boolean;
} | {
    type: "stateVector";
    from: string;
    reply: Uint8Array;
} | {
    type: "update";
    from: string;
    trust: "trusted" | "unknown";
    peer?: TrustedPeer;
    summary: UpdateSummary;
    apply: () => Promise<{
        changed: boolean;
    }>;
    refuse: (reason?: string) => Promise<void>;
};
export declare class OfflineSync {
    private readonly opts;
    constructor(opts: OfflineSyncOptions);
    private frame;
    /** Introduce this device (its public key and name), to be trusted by the other one. */
    hello(): Promise<Uint8Array>;
    /** First pass: what this device has. */
    stateVector(): Promise<Uint8Array>;
    /** The updates this device has and the other one lacks. */
    updateFor(peerStateVector: Uint8Array): Promise<Uint8Array>;
    private logRejected;
    /**
     * Read a frame scanned from the other device. A HELLO is returned for the
     * app to trust its peer; a state vector gives the reply to show; an update
     * gives its summary, applied only when the app calls `apply`.
     */
    receive(bytes: Uint8Array): Promise<Received>;
}
