import { signal, type Signal } from "@preact/signals";
import { CollabDoc } from "./doc";
import {
  VersionLog,
  encodeVersionEntry,
  decodeVersionEntry,
  type VersionEntry,
} from "./versionLog";

/** Payloads exchanged over collab actions (binary deltas and control strings). */
export type CollabPayload = ArrayBuffer | string;

/**
 * The subset of a trystero `Room` that {@link CollabSession} needs. The real
 * trystero `Room` satisfies this structurally; tests provide a lightweight mock.
 *
 * `makeAction`'s sender uses `any` for the trailing (targetPeers / metadata /
 * progress) arguments so trystero's concrete `ActionSender<T>` remains assignable.
 */
export interface CollabRoom {
  makeAction: <T extends CollabPayload>(
    namespace: string,
  ) => [
    (data: T, ...rest: never[]) => unknown,
    (fn: (data: T, peerId: string) => void) => void,
    ...unknown[],
  ];
  onPeerJoin: (fn: (peerId: string) => void) => void;
  onPeerLeave: (fn: (peerId: string) => void) => void;
}

export interface CollabSessionOptions {
  /** This peer's stable site id (trystero selfId). */
  siteId: string;
  /** Existing document to bind (e.g. restored from persistence). */
  doc?: CollabDoc;
  /** Existing version log to bind. */
  versionLog?: VersionLog;
}

// Sync handshake frame tags.
const SYNC_REQUEST = 0;
const SYNC_REPLY = 1;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function frameSync(tag: number, payload: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out.buffer;
}

/**
 * Binds a {@link CollabDoc} and a {@link VersionLog} to a trystero room by wiring
 * three DataChannel actions:
 *
 * - `"doc-update"` — binary Yjs update deltas, broadcast on every local edit and
 *   applied (with a remote origin) on receipt (REQ-COLLAB-011, REQ-COLLAB-012).
 * - `"version"`    — binary-framed version-log entries (REQ-COLLAB-041).
 * - `"sync"`       — the state-vector handshake for late-join / reconnect resync,
 *   which also replays the version log (REQ-COLLAB-020..023).
 *
 * All traffic rides the existing DTLS-encrypted trystero channel; no new signaling
 * secret or server is introduced (REQ-COLLAB-070).
 */
export class CollabSession {
  readonly doc: CollabDoc;
  readonly versionLog: VersionLog;
  /** Reactive list of versions in `(lamport, siteId)` order. */
  readonly versions: Signal<VersionEntry[]>;
  /** Whether at least one peer is currently connected. */
  readonly peerOnline: Signal<boolean> = signal(false);

  private readonly sendDocUpdate: (data: ArrayBuffer) => unknown;
  private readonly sendVersionMsg: (data: ArrayBuffer) => unknown;
  private readonly sendSync: (data: ArrayBuffer) => unknown;
  private readonly unsubscribeDoc: () => void;

  constructor(room: CollabRoom, opts: CollabSessionOptions) {
    this.doc = opts.doc ?? new CollabDoc();
    this.versionLog = opts.versionLog ?? new VersionLog(opts.siteId);
    this.versions = signal(this.versionLog.entries());

    const [sendDoc, getDoc] = room.makeAction<ArrayBuffer>("doc-update");
    const [sendVersion, getVersion] = room.makeAction<ArrayBuffer>("version");
    const [sendSync, getSync] = room.makeAction<ArrayBuffer>("sync");
    this.sendDocUpdate = sendDoc;
    this.sendVersionMsg = sendVersion;
    this.sendSync = sendSync;

    // Broadcast local edits.
    this.unsubscribeDoc = this.doc.onUpdate((update) => {
      void this.sendDocUpdate(toArrayBuffer(update));
    });

    // Apply remote edits without echoing.
    getDoc((data) => {
      this.doc.applyRemote(new Uint8Array(data));
    });

    // Merge remote version-log entries.
    getVersion((data) => {
      const entry = decodeVersionEntry(data);
      this.versionLog.receive(entry);
      this.refreshVersions();
    });

    // Handle the state-vector handshake.
    getSync((data) => {
      const arr = new Uint8Array(data);
      const tag = arr[0];
      const payload = arr.subarray(1);
      if (tag === SYNC_REQUEST) {
        // Reply with the diff the peer is missing, then replay our version log.
        const diff = this.doc.diffSince(payload);
        void this.sendSync(frameSync(SYNC_REPLY, diff));
        this.replayVersions();
      } else if (tag === SYNC_REPLY) {
        this.doc.applyRemote(payload);
      }
    });

    room.onPeerJoin(() => {
      this.peerOnline.value = true;
      this.startHandshake();
    });

    room.onPeerLeave(() => {
      // Peer-leave during editing is recoverable: keep editing locally.
      this.peerOnline.value = false;
    });
  }

  /** Reactive document text (mirrors {@link CollabDoc.docText}). */
  get docText(): Signal<string> {
    return this.doc.docText;
  }

  /** Current character count of the shared document. */
  get length(): number {
    return this.doc.length;
  }

  /** Apply a local text edit and broadcast it to the peer. */
  setText(next: string): void {
    this.doc.setText(next);
  }

  /**
   * Save the current document as a named version, append it to the shared log, and
   * broadcast the entry to the peer (REQ-COLLAB-040, REQ-COLLAB-041).
   */
  saveVersion(label: string): VersionEntry {
    const entry = this.versionLog.save(label, this.doc.encodeSnapshot());
    this.refreshVersions();
    void this.sendVersionMsg(encodeVersionEntry(entry));
    return entry;
  }

  /**
   * Restore a version by applying its snapshot to the live doc. The resulting
   * merge emits an update broadcast as a normal doc-update, so both peers converge
   * (REQ-COLLAB-046).
   */
  restoreVersion(id: string): void {
    const bytes = this.versionLog.restore(id);
    if (!bytes) return;
    // Replay the snapshot's text as a forward edit so it converges on both peers.
    this.doc.setText(CollabDoc.textFromSnapshot(bytes));
  }

  /** Plain text stored in a saved version, for out-of-band QR export. */
  versionText(id: string): string {
    const bytes = this.versionLog.restore(id);
    return bytes ? CollabDoc.textFromSnapshot(bytes) : "";
  }

  /** Initiate the state-vector handshake by sending our state vector. */
  startHandshake(): void {
    void this.sendSync(frameSync(SYNC_REQUEST, this.doc.encodeStateVector()));
  }

  private replayVersions(): void {
    for (const entry of this.versionLog.entries()) {
      void this.sendVersionMsg(encodeVersionEntry(entry));
    }
  }

  private refreshVersions(): void {
    this.versions.value = this.versionLog.entries();
  }

  destroy(): void {
    this.unsubscribeDoc();
    this.doc.destroy();
  }
}
