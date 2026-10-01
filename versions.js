import { ACTIONS } from "./room.js";
import { Emitter } from "./emitter.js";
function compareEntries(a, b) {
    if (a.lamport !== b.lamport)
        return a.lamport - b.lamport;
    if (a.siteId < b.siteId)
        return -1;
    if (a.siteId > b.siteId)
        return 1;
    return 0;
}
/**
 * Append-only, convergent log of named document versions with a Lamport clock.
 * Entries are de-duplicated by `id`, so replays during resync never duplicate.
 */
export class VersionLog {
    siteId;
    items = new Map();
    _lamport = 0;
    constructor(siteId) {
        this.siteId = siteId;
    }
    get lamport() {
        return this._lamport;
    }
    entries() {
        return [...this.items.values()].sort(compareEntries);
    }
    save(label, snapshotBytes, meta = {}) {
        this._lamport += 1;
        const entry = {
            id: crypto.randomUUID(),
            label,
            snapshotBytes,
            siteId: this.siteId,
            lamport: this._lamport,
            savedAt: Date.now(),
            ...(meta.author ? { author: meta.author } : {}),
            ...(meta.auto ? { auto: true } : {}),
        };
        this.items.set(entry.id, entry);
        return entry;
    }
    /** Merge an entry from a peer (or from storage); returns false if already known. */
    receive(entry) {
        if (this.items.has(entry.id))
            return false;
        this._lamport = Math.max(this._lamport, entry.lamport) + 1;
        this.items.set(entry.id, entry);
        return true;
    }
    restore(id) {
        return this.items.get(id)?.snapshotBytes ?? null;
    }
    get(id) {
        return this.items.get(id);
    }
    has(id) {
        return this.items.has(id);
    }
}
/**
 * Binary frame for a {@link VersionEntry}: a 4-byte big-endian header length, a
 * JSON metadata header, then the raw snapshot bytes. Unknown header fields are
 * ignored by older readers, so new metadata stays compatible.
 */
export function encodeVersionEntry(entry) {
    const { snapshotBytes, ...meta } = entry;
    const headerBytes = new TextEncoder().encode(JSON.stringify(meta));
    const out = new Uint8Array(4 + headerBytes.length + snapshotBytes.length);
    new DataView(out.buffer).setUint32(0, headerBytes.length, false);
    out.set(headerBytes, 4);
    out.set(snapshotBytes, 4 + headerBytes.length);
    return out.buffer;
}
export function decodeVersionEntry(buffer) {
    const arr = new Uint8Array(buffer);
    const headerLen = new DataView(arr.buffer, arr.byteOffset, arr.byteLength).getUint32(0, false);
    const header = JSON.parse(new TextDecoder().decode(arr.subarray(4, 4 + headerLen)));
    return { ...header, snapshotBytes: arr.slice(4 + headerLen) };
}
/** Shares a {@link VersionLog} with the peers of a room over the `version` action. */
export class VersionSync extends Emitter {
    log;
    send;
    constructor(room, log) {
        super();
        this.log = log;
        const [send, receive] = room.makeAction(ACTIONS.version);
        this.send = send;
        receive((data) => {
            const entry = decodeVersionEntry(data);
            if (this.log.receive(entry)) {
                this.emit("received", entry);
                this.emit("change", this.log.entries());
            }
        });
    }
    /** Save a version locally and share it. */
    save(label, snapshotBytes, meta = {}) {
        const entry = this.log.save(label, snapshotBytes, meta);
        void this.send(encodeVersionEntry(entry));
        this.emit("change", this.log.entries());
        return entry;
    }
    /** Send the whole log (to a peer that just synced). */
    replay() {
        for (const entry of this.log.entries())
            void this.send(encodeVersionEntry(entry));
    }
}
