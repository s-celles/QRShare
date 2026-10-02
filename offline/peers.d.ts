/**
 * Peer identities for offline sync: an Ed25519 key pair per device, the id
 * other devices know it by, and the list of trusted peers.
 */
import { type DecodedFrame } from "./frame.js";
export interface PeerKey {
    /** 16 bytes: the start of SHA-256 of the public key. */
    id: Uint8Array;
    publicKey: Uint8Array;
    privateKey: CryptoKey;
}
export interface TrustedPeer {
    /** Hex of the 16-byte id. */
    id: string;
    name: string;
    /** Raw Ed25519 public key (32 bytes). */
    publicKey: Uint8Array;
    addedAt: number;
}
export declare function peerId(publicKey: Uint8Array): Promise<Uint8Array>;
/** A new device key; the private key is not extractable (it can be kept in IndexedDB as is). */
export declare function generatePeerKey(): Promise<PeerKey>;
/** HELLO payload: the public key, then the name in UTF-8. */
export declare function helloPayload(publicKey: Uint8Array, name: string): Uint8Array;
export declare function readHello(frame: DecodedFrame): Promise<TrustedPeer>;
export declare function verify(frame: DecodedFrame, publicKey: Uint8Array): Promise<boolean>;
/** Where trusted peers are kept (IndexedDB in an app, memory in tests). */
export interface PeerStore {
    get(id: string): Promise<TrustedPeer | undefined>;
    put(peer: TrustedPeer): Promise<void>;
    list(): Promise<TrustedPeer[]>;
    remove(id: string): Promise<void>;
}
export declare class MemoryPeerStore implements PeerStore {
    private readonly peers;
    get(id: string): Promise<TrustedPeer | undefined>;
    put(peer: TrustedPeer): Promise<void>;
    list(): Promise<TrustedPeer[]>;
    remove(id: string): Promise<void>;
}
/**
 * The trust of a frame: a frame from a known peer must carry its valid
 * signature (rejected otherwise); a frame from an unknown peer is accepted
 * as "unknown" for the app to ask the user.
 */
export declare function checkSender(frame: DecodedFrame, peers: PeerStore): Promise<{
    trust: "trusted" | "unknown";
    peer?: TrustedPeer;
}>;
