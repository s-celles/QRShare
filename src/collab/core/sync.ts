import * as Y from "yjs";
import { ACTIONS, sharedRoom, toArrayBuffer, type CollabRoom } from "./room";
import { Emitter } from "./emitter";

/** Origin of updates applied from the network: never re-broadcast (no echo loop). */
export const REMOTE_ORIGIN = Symbol("collab-remote");

// Sync handshake frame tags.
const SYNC_REQUEST = 0;
const SYNC_REPLY = 1;

function frame(tag: number, payload: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out.buffer;
}

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
export class DocSync extends Emitter<DocSyncEvents> {
  private readonly sendUpdate: (data: ArrayBuffer) => unknown;
  private readonly sendSync: (data: ArrayBuffer) => unknown;
  private readonly peers = new Set<string>();
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return;
    void this.sendUpdate(toArrayBuffer(update));
  };

  constructor(
    room: CollabRoom,
    readonly doc: Y.Doc,
  ) {
    super();
    room = sharedRoom(room);
    const [sendUpdate, onUpdate] = room.makeAction<ArrayBuffer>(ACTIONS.update);
    const [sendSync, onSync] = room.makeAction<ArrayBuffer>(ACTIONS.sync);
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
      } else if (bytes[0] === SYNC_REPLY) {
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

  get peerCount(): number {
    return this.peers.size;
  }

  /** Send our state vector; peers answer with what we miss. */
  handshake(): void {
    void this.sendSync(frame(SYNC_REQUEST, Y.encodeStateVector(this.doc)));
  }

  private applyRemote(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    this.emit("remote", update);
  }

  destroy(): void {
    this.doc.off("update", this.onDocUpdate);
    this.clear();
  }
}
