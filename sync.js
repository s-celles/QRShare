import * as Y from "yjs";
import { ACTIONS, sharedRoom, toArrayBuffer } from "./room.js";
import { Emitter } from "./emitter.js";
/** Origin of updates applied from the network: never re-broadcast (no echo loop). */
export const REMOTE_ORIGIN = Symbol("collab-remote");
// Sync handshake frame tags.
const SYNC_REQUEST = 0;
const SYNC_REPLY = 1;
function frame(tag, payload) {
    const out = new Uint8Array(payload.length + 1);
    out[0] = tag;
    out.set(payload, 1);
    return out.buffer;
}
/**
 * Keeps any `Y.Doc` in sync with the peers of a room:
 *
 * - `doc-update`: binary update deltas, broadcast on every local change and
 *   applied with {@link REMOTE_ORIGIN} on receipt;
 * - `sync`: state-vector handshake on peer join, so a late joiner (or a peer
 *   back from offline) receives exactly what it misses, in both directions.
 */
export class DocSync extends Emitter {
    doc;
    sendUpdate;
    sendSync;
    peers = new Set();
    onDocUpdate = (update, origin) => {
        if (origin === REMOTE_ORIGIN)
            return;
        void this.sendUpdate(toArrayBuffer(update));
    };
    constructor(room, doc) {
        super();
        this.doc = doc;
        room = sharedRoom(room);
        const [sendUpdate, onUpdate] = room.makeAction(ACTIONS.update);
        const [sendSync, onSync] = room.makeAction(ACTIONS.sync);
        this.sendUpdate = sendUpdate;
        this.sendSync = sendSync;
        doc.on("update", this.onDocUpdate);
        onUpdate((data) => this.applyRemote(new Uint8Array(data)));
        onSync((data, peerId) => {
            const bytes = new Uint8Array(data);
            const payload = bytes.subarray(1);
            if (bytes[0] === SYNC_REQUEST) {
                void this.sendSync(frame(SYNC_REPLY, Y.encodeStateAsUpdate(this.doc, payload)));
                this.emit("sync-request", peerId);
            }
            else if (bytes[0] === SYNC_REPLY) {
                this.applyRemote(payload);
            }
        });
        room.onPeerJoin((peerId) => {
            this.peers.add(peerId);
            this.emit("peers", this.peers.size);
            this.handshake();
        });
        room.onPeerLeave((peerId) => {
            this.peers.delete(peerId);
            this.emit("peers", this.peers.size);
        });
    }
    get peerCount() {
        return this.peers.size;
    }
    /** Send our state vector; peers answer with what we miss. */
    handshake() {
        void this.sendSync(frame(SYNC_REQUEST, Y.encodeStateVector(this.doc)));
    }
    applyRemote(update) {
        Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
        this.emit("remote", update);
    }
    destroy() {
        this.doc.off("update", this.onDocUpdate);
        this.clear();
    }
}
