/**
 * Peer identities for offline sync: an Ed25519 key pair per device, the id
 * other devices know it by, and the list of trusted peers.
 */
import { FrameError, toHex, type DecodedFrame } from "./frame";

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

export async function peerId(publicKey: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey as BufferSource)).slice(0, 16);
}

/** A new device key; the private key is not extractable (it can be kept in IndexedDB as is). */
export async function generatePeerKey(): Promise<PeerKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { id: await peerId(publicKey), publicKey, privateKey: pair.privateKey };
}

/** HELLO payload: the public key, then the name in UTF-8. */
export function helloPayload(publicKey: Uint8Array, name: string): Uint8Array {
  const n = new TextEncoder().encode(name.slice(0, 120));
  const out = new Uint8Array(32 + n.length);
  out.set(publicKey);
  out.set(n, 32);
  return out;
}

export async function readHello(frame: DecodedFrame): Promise<TrustedPeer> {
  if (frame.payload.length < 32) throw new FrameError("invalid", "HELLO without a public key");
  const publicKey = frame.payload.slice(0, 32);
  const id = await peerId(publicKey);
  if (toHex(id) !== toHex(frame.senderId)) throw new FrameError("invalid", "HELLO sender does not match its key");
  // A HELLO must be signed by the key it introduces.
  if (!frame.signature || !(await verify(frame, publicKey))) throw new FrameError("signature", "HELLO not signed by its key");
  return { id: toHex(id), name: new TextDecoder().decode(frame.payload.slice(32)).trim() || toHex(id).slice(0, 8), publicKey, addedAt: Date.now() };
}

export async function verify(frame: DecodedFrame, publicKey: Uint8Array): Promise<boolean> {
  if (!frame.signature) return false;
  try {
    const key = await crypto.subtle.importKey("raw", publicKey as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, frame.signature as BufferSource, frame.signedBytes as BufferSource);
  } catch {
    return false;
  }
}

/** Where trusted peers are kept (IndexedDB in an app, memory in tests). */
export interface PeerStore {
  get(id: string): Promise<TrustedPeer | undefined>;
  put(peer: TrustedPeer): Promise<void>;
  list(): Promise<TrustedPeer[]>;
  remove(id: string): Promise<void>;
}

export class MemoryPeerStore implements PeerStore {
  private readonly peers = new Map<string, TrustedPeer>();
  async get(id: string) {
    return this.peers.get(id);
  }
  async put(peer: TrustedPeer) {
    this.peers.set(peer.id, peer);
  }
  async list() {
    return [...this.peers.values()];
  }
  async remove(id: string) {
    this.peers.delete(id);
  }
}

/**
 * The trust of a frame: a frame from a known peer must carry its valid
 * signature (rejected otherwise); a frame from an unknown peer is accepted
 * as "unknown" for the app to ask the user.
 */
export async function checkSender(frame: DecodedFrame, peers: PeerStore): Promise<{ trust: "trusted" | "unknown"; peer?: TrustedPeer }> {
  const peer = await peers.get(toHex(frame.senderId));
  if (!peer) return { trust: "unknown" };
  if (!frame.signature) throw new FrameError("signature", `Unsigned frame from the known peer ${peer.name}`);
  if (!(await verify(frame, peer.publicKey))) throw new FrameError("signature", `Invalid signature for the known peer ${peer.name}`);
  return { trust: "trusted", peer };
}
