import type * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { type CollabRoom } from "./room.js";
import { Emitter } from "./emitter.js";
import type { Identity } from "./identity.js";
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
/**
 * Who is here and where they are working, over the `aware` action, using
 * y-protocols' awareness (states time out when a peer stops renewing them, and
 * are removed at once when it leaves the room).
 */
export declare class Presence extends Emitter<PresenceEvents> {
    readonly awareness: Awareness;
    private readonly send;
    /** Awareness client ids announced by each room peer. */
    private readonly clientsByPeer;
    constructor(room: CollabRoom, doc: Y.Doc, identity: Identity);
    /** Send our state (to a peer that just joined). */
    announce(): void;
    /** Update part of our state (cursor, identity…). */
    update(patch: Partial<PresenceState>): void;
    /** Everyone here, this peer first. */
    participants(): Participant[];
    destroy(): void;
}
