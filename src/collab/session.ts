import { signal, type Signal } from "@preact/signals";
import { CollabDoc } from "./doc";
import { CollabSession as CoreSession } from "./core/session";
import { loadIdentity, type Identity } from "./core/identity";
import type { Participant } from "./core/presence";
import type { VersionLog, VersionEntry } from "./core/versions";
import type { CollabRoom } from "./core/room";

export type { CollabPayload, CollabRoom } from "./core/room";

export interface CollabSessionOptions {
  /** This peer's stable site id (trystero selfId). */
  siteId: string;
  /** Existing document to bind (e.g. restored from persistence). */
  doc?: CollabDoc;
  /** Existing version log to bind. */
  versionLog?: VersionLog;
  /** How this participant appears to the other (remembered on this device by default). */
  identity?: Identity;
}

/**
 * Binds the plain-text {@link CollabDoc} to a trystero room through the shared
 * collaboration core (`@/collab/core`): document sync and late-join handshake
 * (REQ-COLLAB-011..023), shared version log (REQ-COLLAB-040..048) and presence.
 * This class only adds Preact signals for the UI.
 *
 * All traffic rides the existing DTLS-encrypted trystero channel; no new signaling
 * secret or server is introduced (REQ-COLLAB-070).
 */
export class CollabSession {
  readonly doc: CollabDoc;
  readonly core: CoreSession;
  /** Reactive list of versions in `(lamport, siteId)` order. */
  readonly versions: Signal<VersionEntry[]>;
  /** Whether at least one peer is currently connected. */
  readonly peerOnline: Signal<boolean> = signal(false);
  /** Who is in the session (this peer first). */
  readonly participants: Signal<Participant[]>;

  constructor(room: CollabRoom, opts: CollabSessionOptions) {
    this.doc = opts.doc ?? new CollabDoc();
    this.core = new CoreSession(room, {
      siteId: opts.siteId,
      doc: this.doc.ydoc,
      identity: opts.identity ?? loadIdentity("qrshare.collab.identity"),
      ...(opts.versionLog ? { versionLog: opts.versionLog } : {}),
    });
    this.versions = signal(this.core.versions);
    this.participants = signal(this.core.participants);
    this.core.on("versions", (v) => (this.versions.value = v));
    this.core.on("participants", (p) => (this.participants.value = p));
    // Peer-leave during editing is recoverable: keep editing locally.
    this.core.on("peers", (n) => (this.peerOnline.value = n > 0));
  }

  get versionLog(): VersionLog {
    return this.core.versionLog;
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

  /** Save the current document as a named, shared version (REQ-COLLAB-040, REQ-COLLAB-041). */
  saveVersion(label: string): VersionEntry {
    return this.core.saveVersion(label);
  }

  /** Restore a version as a forward edit that converges on both peers (REQ-COLLAB-046). */
  restoreVersion(id: string): void {
    const bytes = this.versionLog.restore(id);
    if (bytes) this.doc.setText(CollabDoc.textFromSnapshot(bytes));
  }

  /** Plain text stored in a saved version, for out-of-band QR export. */
  versionText(id: string): string {
    const bytes = this.versionLog.restore(id);
    return bytes ? CollabDoc.textFromSnapshot(bytes) : "";
  }

  /** Initiate the state-vector handshake by sending our state vector. */
  startHandshake(): void {
    this.core.handshake();
  }

  destroy(): void {
    this.core.destroy();
    this.doc.destroy();
  }
}
