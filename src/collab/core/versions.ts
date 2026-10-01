import { ACTIONS, type CollabRoom } from "./room";
import { Emitter } from "./emitter";

/**
 * A saved, labelled snapshot of the shared document.
 *
 * Entries are ordered by `(lamport, siteId)` — a per-peer logical clock with the
 * site id as tie-breaker — never by wall-clock time, which is unsafe across
 * unsynchronized devices. `author` and `savedAt` are informative only.
 */
export interface VersionEntry {
  /** Stable UUID, identical across peers, used for de-duplication. */
  id: string;
  label: string;
  /** Full `Y.encodeStateAsUpdate` snapshot of the document at save time. */
  snapshotBytes: Uint8Array;
  /** The saving peer's site id. */
  siteId: string;
  /** Per-peer logical clock value. */
  lamport: number;
  /** Display name of the person who saved it. */
  author?: string;
  /** Wall-clock time of the save (ms since epoch), for display. */
  savedAt?: number;
  /** Saved automatically rather than by a person. */
  auto?: boolean;
}

function compareEntries(a: VersionEntry, b: VersionEntry): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.siteId < b.siteId) return -1;
  if (a.siteId > b.siteId) return 1;
  return 0;
}

/**
 * Append-only, convergent log of named document versions with a Lamport clock.
 * Entries are de-duplicated by `id`, so replays during resync never duplicate.
 */
export class VersionLog {
  private readonly items = new Map<string, VersionEntry>();
  private _lamport = 0;

  constructor(private readonly siteId: string) {}

  get lamport(): number {
    return this._lamport;
  }

  entries(): VersionEntry[] {
    return [...this.items.values()].sort(compareEntries);
  }

  save(label: string, snapshotBytes: Uint8Array, meta: Pick<VersionEntry, "author" | "auto"> = {}): VersionEntry {
    this._lamport += 1;
    const entry: VersionEntry = {
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
  receive(entry: VersionEntry): boolean {
    if (this.items.has(entry.id)) return false;
    this._lamport = Math.max(this._lamport, entry.lamport) + 1;
    this.items.set(entry.id, entry);
    return true;
  }

  restore(id: string): Uint8Array | null {
    return this.items.get(id)?.snapshotBytes ?? null;
  }

  get(id: string): VersionEntry | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }
}

/**
 * Binary frame for a {@link VersionEntry}: a 4-byte big-endian header length, a
 * JSON metadata header, then the raw snapshot bytes. Unknown header fields are
 * ignored by older readers, so new metadata stays compatible.
 */
export function encodeVersionEntry(entry: VersionEntry): ArrayBuffer {
  const { snapshotBytes, ...meta } = entry;
  const headerBytes = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + headerBytes.length + snapshotBytes.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(snapshotBytes, 4 + headerBytes.length);
  return out.buffer;
}

export function decodeVersionEntry(buffer: ArrayBuffer): VersionEntry {
  const arr = new Uint8Array(buffer);
  const headerLen = new DataView(arr.buffer, arr.byteOffset, arr.byteLength).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(arr.subarray(4, 4 + headerLen))) as Omit<VersionEntry, "snapshotBytes">;
  return { ...header, snapshotBytes: arr.slice(4 + headerLen) };
}

export interface VersionSyncEvents extends Record<string, unknown> {
  /** The list changed (local save or entry received). */
  change: VersionEntry[];
  /** A new entry arrived from a peer. */
  received: VersionEntry;
}

/** Shares a {@link VersionLog} with the peers of a room over the `version` action. */
export class VersionSync extends Emitter<VersionSyncEvents> {
  private readonly send: (data: ArrayBuffer) => unknown;

  constructor(
    room: CollabRoom,
    readonly log: VersionLog,
  ) {
    super();
    const [send, receive] = room.makeAction<ArrayBuffer>(ACTIONS.version);
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
  save(label: string, snapshotBytes: Uint8Array, meta: Pick<VersionEntry, "author" | "auto"> = {}): VersionEntry {
    const entry = this.log.save(label, snapshotBytes, meta);
    void this.send(encodeVersionEntry(entry));
    this.emit("change", this.log.entries());
    return entry;
  }

  /** Send the whole log (to a peer that just synced). */
  replay(): void {
    for (const entry of this.log.entries()) void this.send(encodeVersionEntry(entry));
  }
}
