import * as Y from "yjs";
import { Emitter } from "./emitter.js";
import { DocSync } from "./sync.js";
import { VersionLog, VersionSync } from "./versions.js";
import { Presence } from "./presence.js";
import { attachDocPersistence, loadVersionEntries, saveVersionEntry } from "./persistence.js";
import { docFromSnapshot, restoreShared } from "./restore.js";
/**
 * A serverless collaboration session: document sync, presence and a shared
 * version history, over one peer-to-peer room. Every participant keeps the full
 * document and history; nothing goes through a server.
 */
export class CollabSession extends Emitter {
    doc;
    sync;
    versionSync;
    presence;
    identity;
    persistence = null;
    unpersist = null;
    constructor(room, opts) {
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
    get versionLog() {
        return this.versionSync.log;
    }
    get versions() {
        return this.versionLog.entries();
    }
    get participants() {
        return this.presence.participants();
    }
    get peerCount() {
        return this.sync.peerCount;
    }
    /** Change how this participant appears. */
    setIdentity(identity) {
        this.identity = identity;
        this.presence.update({ user: identity });
    }
    /** Share where this participant is working (selected cell, caret…). */
    setCursor(cursor) {
        this.presence.update({ cursor });
    }
    /** Ask connected peers for what we miss (after attaching to an existing room). */
    handshake() {
        this.sync.handshake();
        this.presence.announce();
    }
    /** Save the current document as a named version, shared with everyone. */
    saveVersion(label, opts = {}) {
        return this.versionSync.save(label, Y.encodeStateAsUpdate(this.doc), { author: this.identity.name, ...opts });
    }
    /** A standalone document holding a saved version (null if unknown); destroy it after use. */
    versionDoc(id) {
        const bytes = this.versionLog.restore(id);
        return bytes ? docFromSnapshot(bytes) : null;
    }
    /** Bring the document back to a saved version, as a new edit that reaches everyone. */
    restoreVersion(id, schema) {
        const old = this.versionDoc(id);
        if (!old)
            return false;
        restoreShared(this.doc, old, schema);
        old.destroy();
        return true;
    }
    /**
     * Keep the document and history in IndexedDB so a reload restores them.
     * Stored history is merged into the log; later entries are stored as they come.
     */
    async persist(opts) {
        this.persistence = await attachDocPersistence(opts, this.doc);
        let added = false;
        for (const entry of await loadVersionEntries(opts))
            added = this.versionLog.receive(entry) || added;
        if (added)
            this.emit("versions", this.versions);
        for (const entry of this.versions)
            void saveVersionEntry(opts, entry);
        const stored = new Set(this.versions.map((e) => e.id));
        this.unpersist = this.versionSync.on("change", (entries) => {
            for (const entry of entries) {
                if (stored.has(entry.id))
                    continue;
                stored.add(entry.id);
                void saveVersionEntry(opts, entry);
            }
        });
    }
    destroy() {
        this.unpersist?.();
        void this.persistence?.destroy();
        this.presence.destroy();
        this.versionSync.clear();
        this.sync.destroy();
        this.clear();
    }
}
