/** Payloads exchanged over room actions (binary deltas and control strings). */
export type CollabPayload = ArrayBuffer | string;

/**
 * The subset of a trystero `Room` the collaboration layer needs. A trystero room
 * satisfies it structurally; tests use an in-memory mock. Action names must stay
 * within trystero's 12-byte limit.
 *
 * `makeAction`'s sender accepts trailing (target peers / metadata / progress)
 * arguments so trystero's `ActionSender<T>` remains assignable.
 */
export interface CollabRoom {
  makeAction: <T extends CollabPayload>(
    namespace: string,
  ) => [(data: T, ...rest: never[]) => unknown, (fn: (data: T, peerId: string) => void) => void, ...unknown[]];
  onPeerJoin: (fn: (peerId: string) => void) => void;
  onPeerLeave: (fn: (peerId: string) => void) => void;
}

/** Action names, shared by every app speaking this protocol. */
export const ACTIONS = { update: "doc-update", sync: "sync", version: "version", presence: "aware" } as const;

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const hubs = new WeakMap<object, CollabRoom>();

/**
 * A view of `room` on which several listeners can subscribe to peer joins and
 * leaves (a trystero room keeps only the last handler of each).
 */
export function sharedRoom(room: CollabRoom): CollabRoom {
  const known = hubs.get(room);
  if (known) return known;
  const joins = new Set<(peerId: string) => void>();
  const leaves = new Set<(peerId: string) => void>();
  room.onPeerJoin((peerId) => joins.forEach((fn) => fn(peerId)));
  room.onPeerLeave((peerId) => leaves.forEach((fn) => fn(peerId)));
  const hub: CollabRoom = {
    makeAction: (namespace) => room.makeAction(namespace),
    onPeerJoin: (fn) => void joins.add(fn),
    onPeerLeave: (fn) => void leaves.add(fn),
  };
  hubs.set(room, hub);
  hubs.set(hub, hub);
  return hub;
}
