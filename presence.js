import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { ACTIONS, sharedRoom, toArrayBuffer } from "./room.js";
import { Emitter } from "./emitter.js";
const REMOTE = "remote";
/**
 * Who is here and where they are working, over the `aware` action, using
 * y-protocols' awareness (states time out when a peer stops renewing them, and
 * are removed at once when it leaves the room).
 */
export class Presence extends Emitter {
    awareness;
    send;
    /** Awareness client ids announced by each room peer. */
    clientsByPeer = new Map();
    constructor(room, doc, identity) {
        super();
        room = sharedRoom(room);
        this.awareness = new Awareness(doc);
        this.awareness.setLocalState({ user: identity });
        const [send, receive] = room.makeAction(ACTIONS.presence);
        this.send = send;
        this.awareness.on("update", ({ added, updated, removed }, origin) => {
            if (origin === REMOTE)
                return;
            const changed = [...added, ...updated, ...removed];
            if (changed.length)
                void this.send(toArrayBuffer(encodeAwarenessUpdate(this.awareness, changed)));
        });
        this.awareness.on("change", () => this.emit("change", this.participants()));
        receive((data, peerId) => {
            const update = new Uint8Array(data);
            // Remember which clients this peer speaks for, to drop them when it leaves.
            const before = new Set(this.awareness.getStates().keys());
            applyAwarenessUpdate(this.awareness, update, REMOTE);
            let clients = this.clientsByPeer.get(peerId);
            if (!clients)
                this.clientsByPeer.set(peerId, (clients = new Set()));
            for (const id of this.awareness.getStates().keys())
                if (!before.has(id) && id !== doc.clientID)
                    clients.add(id);
        });
        room.onPeerJoin(() => this.announce());
        room.onPeerLeave((peerId) => {
            const clients = this.clientsByPeer.get(peerId);
            this.clientsByPeer.delete(peerId);
            if (clients?.size)
                removeAwarenessStates(this.awareness, [...clients], REMOTE);
        });
    }
    /** Send our state (to a peer that just joined). */
    announce() {
        void this.send(toArrayBuffer(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])));
    }
    /** Update part of our state (cursor, identity…). */
    update(patch) {
        const current = (this.awareness.getLocalState() ?? {});
        this.awareness.setLocalState({ ...current, ...patch });
    }
    /** Everyone here, this peer first. */
    participants() {
        const out = [];
        for (const [clientId, state] of this.awareness.getStates()) {
            const s = state;
            if (!s.user || typeof s.user.name !== "string")
                continue;
            out.push({ ...s, clientId, self: clientId === this.awareness.clientID });
        }
        return out.sort((a, b) => Number(b.self) - Number(a.self) || a.user.name.localeCompare(b.user.name));
    }
    destroy() {
        removeAwarenessStates(this.awareness, [this.awareness.clientID], "local");
        this.awareness.destroy();
        this.clear();
    }
}
