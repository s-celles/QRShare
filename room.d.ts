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
    makeAction: <T extends CollabPayload>(namespace: string) => [(data: T, ...rest: never[]) => unknown, (fn: (data: T, peerId: string) => void) => void, ...unknown[]];
    onPeerJoin: (fn: (peerId: string) => void) => void;
    onPeerLeave: (fn: (peerId: string) => void) => void;
}
/** Action names, shared by every app speaking this protocol. */
export declare const ACTIONS: {
    readonly update: "doc-update";
    readonly sync: "sync";
    readonly version: "version";
    readonly presence: "aware";
};
export declare function toArrayBuffer(bytes: Uint8Array): ArrayBuffer;
/**
 * A view of `room` on which several listeners can subscribe to peer joins and
 * leaves (a trystero room keeps only the last handler of each).
 */
export declare function sharedRoom(room: CollabRoom): CollabRoom;
