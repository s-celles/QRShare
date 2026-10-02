/**
 * One device's side of an offline sync: makes the frames to show and
 * handles the frames scanned from the other device.
 */
import * as Y from "yjs";
import { decodeFrame, encodeFrame, FrameError, FrameType, toHex, DEFAULT_MAX_BYTES, type DecodedFrame } from "./frame";
import { checkSender, helloPayload, readHello, type PeerKey, type PeerStore, type TrustedPeer } from "./peers";
import { applyValidated, stateVector, summarize, updateFor, type UpdateSummary } from "./sync";
import type { ImportLog } from "./log";

export interface OfflineSyncOptions {
  doc: Y.Doc;
  /** UUID of the shared document. */
  docId: string;
  key: PeerKey;
  name: string;
  peers: PeerStore;
  log: ImportLog;
  /** Checks the document after an update, on an isolated copy; throws to refuse it. */
  validate?: (copy: Y.Doc) => void;
  maxBytes?: number;
}

/** What a scanned frame asks for, before anything is applied. */
export type Received =
  | { type: "hello"; peer: TrustedPeer; known: boolean }
  | { type: "stateVector"; from: string; reply: Uint8Array }
  | { type: "update"; from: string; trust: "trusted" | "unknown"; peer?: TrustedPeer; summary: UpdateSummary; apply: () => Promise<{ changed: boolean }>; refuse: (reason?: string) => Promise<void> };

export class OfflineSync {
  constructor(private readonly opts: OfflineSyncOptions) {}

  private frame(type: FrameType, payload: Uint8Array): Promise<Uint8Array> {
    return encodeFrame({ type, docId: this.opts.docId, senderId: this.opts.key.id, payload }, { signWith: this.opts.key.privateKey });
  }

  /** Introduce this device (its public key and name), to be trusted by the other one. */
  hello(): Promise<Uint8Array> {
    return this.frame(FrameType.HELLO, helloPayload(this.opts.key.publicKey, this.opts.name));
  }

  /** First pass: what this device has. */
  stateVector(): Promise<Uint8Array> {
    return this.frame(FrameType.STATE_VECTOR, stateVector(this.opts.doc));
  }

  /** The updates this device has and the other one lacks. */
  updateFor(peerStateVector: Uint8Array): Promise<Uint8Array> {
    return this.frame(FrameType.UPDATE, updateFor(this.opts.doc, peerStateVector));
  }

  private async logRejected(frame: DecodedFrame | undefined, bytes: number, reason: string): Promise<void> {
    await this.opts.log.add({ at: Date.now(), docId: frame?.docId ?? this.opts.docId, peer: frame ? toHex(frame.senderId) : "?", trust: "unknown", bytes, result: "rejected", reason });
  }

  /**
   * Read a frame scanned from the other device. A HELLO is returned for the
   * app to trust its peer; a state vector gives the reply to show; an update
   * gives its summary, applied only when the app calls `apply`.
   */
  async receive(bytes: Uint8Array): Promise<Received> {
    let frame: DecodedFrame | undefined;
    try {
      frame = await decodeFrame(bytes, { maxBytes: this.opts.maxBytes ?? DEFAULT_MAX_BYTES });
      if (frame.type === FrameType.HELLO) {
        const peer = await readHello(frame);
        return { type: "hello", peer, known: !!(await this.opts.peers.get(peer.id)) };
      }
      if (frame.docId !== this.opts.docId) throw new FrameError("invalid", "This frame is for another document");
      const { trust, peer } = await checkSender(frame, this.opts.peers);
      if (frame.type === FrameType.STATE_VECTOR) return { type: "stateVector", from: toHex(frame.senderId), reply: await this.updateFor(frame.payload) };
      if (frame.type !== FrameType.UPDATE) throw new FrameError("type", "Pictures are not handled yet");
      const f = frame;
      const summary = summarize(f.payload);
      const base = { at: Date.now(), docId: f.docId, peer: toHex(f.senderId), ...(peer ? { peerName: peer.name } : {}), trust, bytes: f.payload.length };
      return {
        type: "update",
        from: base.peer,
        trust,
        ...(peer ? { peer } : {}),
        summary,
        apply: async () => {
          try {
            const { changed } = applyValidated(this.opts.doc, f.payload, this.opts.validate);
            await this.opts.log.add({ ...base, result: changed ? "applied" : "unchanged" });
            return { changed };
          } catch (err) {
            await this.opts.log.add({ ...base, result: "rejected", reason: (err as Error).message });
            throw err;
          }
        },
        refuse: async (reason) => this.opts.log.add({ ...base, result: "refused", ...(reason ? { reason } : {}) }),
      };
    } catch (err) {
      await this.logRejected(frame, bytes.length, (err as Error).message);
      throw err;
    }
  }
}
