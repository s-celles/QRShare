import * as Y from "yjs";
import type { CollabRoom } from "./room";
import { Emitter } from "./emitter";
import { DocSync } from "./sync";
import { VersionLog, VersionSync, type VersionEntry } from "./versions";
import { Presence, type Participant } from "./presence";
import type { Identity } from "./identity";
import { attachDocPersistence, loadVersionEntries, saveVersionEntry, type DocPersistence, type PersistenceOptions } from "./persistence";
import { docFromSnapshot, restoreShared, type Schema } from "./restore";

export interface CollabSessionOptions {
  /** This peer's stable id in the room (trystero `selfId`). */
  siteId: string;
  /** How this participant appears to the others. */
  identity: Identity;
  /** Document to share (a new one by default). */
  doc?: Y.Doc;
  /** Version log to share (a new one by default). */
  versionLog?: VersionLog;
}

export interface CollabSessionEvents extends Record<string, unknown> {
  versions: VersionEntry[];
  participants: Participant[];
  peers: number;
  /** A remote update was applied to the document. */
  remote: Uint8Array;
}

/**
 * A serverless collaboration session: document sync, presence and a shared
 * version history, over one peer-to-peer room. Every participant keeps the full
 * document and history; nothing goes through a server.
 */
export class CollabSession extends Emitter<CollabSessionEvents> {
  readonly doc: Y.Doc;
  readonly sync: DocSync;
  readonly versionSync: VersionSync;
  readonly presence: Presence;
  private identity: Identity;
  private persistence: DocPersistence | null = null;
  private unpersist: (() => void) | null = null;

  constructor(room: CollabRoom, opts: CollabSessionOptions) {
    super();
    this.doc = opts.doc ?? new Y.Doc();
    this.identity = opts.identity;
    this.sync = new DocSync(room, this.doc);
    this.versionSync = new VersionSync(room, opts.versionLog ?? new VersionLog(opts.siteId));
    this.presence = new Presence(room, this.doc, opts.identity);
    // A peer that (re)joined gets the history along with the missing edits.
    this.sync.on("sync-request", () => this.versionSync.replay());
    this.sync.on("peers", (n) => this.emit("peers", n));
    this.sync.on("remote", (u) => this.emit("remote", u));
    this.versionSync.on("change", (v) => this.emit("versions", v));
    this.presence.on("change", (p) => this.emit("participants", p));
  }

  get versionLog(): VersionLog {
    return this.versionSync.log;
  }

  get versions(): VersionEntry[] {
    return this.versionLog.entries();
  }

  get participants(): Participant[] {
    return this.presence.participants();
  }

  get peerCount(): number {
    return this.sync.peerCount;
  }

  /** Change how this participant appears. */
  setIdentity(identity: Identity): void {
    this.identity = identity;
    this.presence.update({ user: identity });
  }

  /** Share where this participant is working (selected cell, caret…). */
  setCursor(cursor: unknown): void {
    this.presence.update({ cursor });
  }

  /** Ask connected peers for what we miss (after attaching to an existing room). */
  handshake(): void {
    this.sync.handshake();
    this.presence.announce();
  }

  /** Save the current document as a named version, shared with everyone. */
  saveVersion(label: string, opts: { auto?: boolean } = {}): VersionEntry {
    return this.versionSync.save(label, Y.encodeStateAsUpdate(this.doc), { author: this.identity.name, ...opts });
  }

  /** A standalone document holding a saved version (null if unknown); destroy it after use. */
  versionDoc(id: string): Y.Doc | null {
    const bytes = this.versionLog.restore(id);
    return bytes ? docFromSnapshot(bytes) : null;
  }

  /** Bring the document back to a saved version, as a new edit that reaches everyone. */
  restoreVersion(id: string, schema: Schema): boolean {
    const old = this.versionDoc(id);
    if (!old) return false;
    restoreShared(this.doc, old, schema);
    old.destroy();
    return true;
  }

  /**
   * Keep the document and history in IndexedDB so a reload restores them.
   * Stored history is merged into the log; later entries are stored as they come.
   */
  async persist(opts: PersistenceOptions): Promise<void> {
    this.persistence = await attachDocPersistence(opts, this.doc);
    let added = false;
    for (const entry of await loadVersionEntries(opts)) added = this.versionLog.receive(entry) || added;
    if (added) this.emit("versions", this.versions);
    for (const entry of this.versions) void saveVersionEntry(opts, entry);
    const stored = new Set(this.versions.map((e) => e.id));
    this.unpersist = this.versionSync.on("change", (entries) => {
      for (const entry of entries) {
        if (stored.has(entry.id)) continue;
        stored.add(entry.id);
        void saveVersionEntry(opts, entry);
      }
    });
  }

  destroy(): void {
    this.unpersist?.();
    void this.persistence?.destroy();
    this.presence.destroy();
    this.versionSync.clear();
    this.sync.destroy();
    this.clear();
  }
}
