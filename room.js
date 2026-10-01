/** Action names, shared by every app speaking this protocol. */
export const ACTIONS = { update: "doc-update", sync: "sync", version: "version", presence: "aware" };
export function toArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
const hubs = new WeakMap();
/**
 * A view of `room` on which several listeners can subscribe to peer joins and
 * leaves (a trystero room keeps only the last handler of each).
 */
export function sharedRoom(room) {
    const known = hubs.get(room);
    if (known)
        return known;
    const joins = new Set();
    const leaves = new Set();
    room.onPeerJoin((peerId) => joins.forEach((fn) => fn(peerId)));
    room.onPeerLeave((peerId) => leaves.forEach((fn) => fn(peerId)));
    const hub = {
        makeAction: (namespace) => room.makeAction(namespace),
        onPeerJoin: (fn) => void joins.add(fn),
        onPeerLeave: (fn) => void leaves.add(fn),
    };
    hubs.set(room, hub);
    hubs.set(hub, hub);
    return hub;
}
