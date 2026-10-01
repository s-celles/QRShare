import type * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { ACTIONS, sharedRoom, toArrayBuffer, type CollabRoom } from "./room";
import { Emitter } from "./emitter";
import type { Identity } from "./identity";

/** What a participant shares about itself; apps may add their own fields. */
export interface PresenceState {
  user: Identity;
  /** App-defined position (selected cell, caret offsets…). */
  cursor?: unknown;
  [key: string]: unknown;
}

/** A participant, as seen by this peer. */
export interface Participant extends PresenceState {
  /** Yjs client id (stable for the lifetime of the participant's document). */
  clientId: number;
  /** Whether it is this peer. */
  self: boolean;
}

export interface PresenceEvents extends Record<string, unknown> {
  change: Participant[];
}

const REMOTE = "remote";

/**
 * Who is here and where they are working, over the `aware` action, using
 * y-protocols' awareness (states time out when a peer stops renewing them, and
 * are removed at once when it leaves the room).
 */
export class Presence extends Emitter<PresenceEvents> {
  readonly awareness: Awareness;
  private readonly send: (data: ArrayBuffer) => unknown;
  /** Awareness client ids announced by each room peer. */
  private readonly clientsByPeer = new Map<string, Set<number>>();

  constructor(room: CollabRoom, doc: Y.Doc, identity: Identity) {
    super();
    room = sharedRoom(room);
    this.awareness = new Awareness(doc);
    this.awareness.setLocalState({ user: identity } satisfies PresenceState);
    const [send, receive] = room.makeAction<ArrayBuffer>(ACTIONS.presence);
    this.send = send;

    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE) return;
      const changed = [...added, ...updated, ...removed];
      if (changed.length) void this.send(toArrayBuffer(encodeAwarenessUpdate(this.awareness, changed)));
    });
    this.awareness.on("change", () => this.emit("change", this.participants()));

    receive((data, peerId) => {
      const update = new Uint8Array(data);
      // Remember which clients this peer speaks for, to drop them when it leaves.
      const before = new Set(this.awareness.getStates().keys());
      applyAwarenessUpdate(this.awareness, update, REMOTE);
      let clients = this.clientsByPeer.get(peerId);
      if (!clients) this.clientsByPeer.set(peerId, (clients = new Set()));
      for (const id of this.awareness.getStates().keys()) if (!before.has(id) && id !== doc.clientID) clients.add(id);
    });
    room.onPeerJoin(() => this.announce());
    room.onPeerLeave((peerId) => {
      const clients = this.clientsByPeer.get(peerId);
      this.clientsByPeer.delete(peerId);
      if (clients?.size) removeAwarenessStates(this.awareness, [...clients], REMOTE);
    });
  }

  /** Send our state (to a peer that just joined). */
  announce(): void {
    void this.send(toArrayBuffer(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])));
  }

  /** Update part of our state (cursor, identity…). */
  update(patch: Partial<PresenceState>): void {
    const current = (this.awareness.getLocalState() ?? {}) as PresenceState;
    this.awareness.setLocalState({ ...current, ...patch });
  }

  /** Everyone here, this peer first. */
  participants(): Participant[] {
    const out: Participant[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const s = state as Partial<PresenceState>;
      if (!s.user || typeof s.user.name !== "string") continue;
      out.push({ ...(s as PresenceState), clientId, self: clientId === this.awareness.clientID });
    }
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.user.name.localeCompare(b.user.name));
  }

  destroy(): void {
    removeAwarenessStates(this.awareness, [this.awareness.clientID], "local");
    this.awareness.destroy();
    this.clear();
  }
}
