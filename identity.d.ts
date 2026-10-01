/** How a participant appears to the others. */
export interface Identity {
    /** Compound name such as "Swift Crimson Falcon". */
    name: string;
    /** CSS colour of the participant's cursor and badge, readable on white. */
    color: string;
}
/** The colour matching the colour word of a compound name. */
export declare function colorOf(name: string): string;
/** A random (or seeded) identity: adjective + colour + animal. */
export declare function createIdentity(seed?: string | number): Identity;
/**
 * The identity remembered on this device under `key` (created on first use).
 * Falls back to a fresh identity when storage is unavailable.
 */
export declare function loadIdentity(key?: string): Identity;
export declare function saveIdentity(identity: Identity, key?: string): void;
