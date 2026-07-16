/**
 * A saved, labeled snapshot of the shared document.
 *
 * Entries are ordered deterministically by `(lamport, siteId)` — a per-peer
 * logical (Lamport) clock with the site id as tie-breaker — never by wall-clock
 * time, which is unsafe across two unsynchronized devices
 * (REQ-COLLAB-042, REQ-COLLAB-043).
 */
export interface VersionEntry {
  /** Stable UUID, identical across peers, used for de-duplication. */
  id: string;
  label: string;
  /** Full `Y.encodeStateAsUpdate` snapshot of the document at save time. */
  snapshotBytes: Uint8Array;
  /** The saving peer's trystero self id. */
  siteId: string;
  /** Per-peer logical clock value. */
  lamport: number;
}

/** Deterministic ordering key: lamport ascending, tie-break by siteId string. */
function compareEntries(a: VersionEntry, b: VersionEntry): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.siteId < b.siteId) return -1;
  if (a.siteId > b.siteId) return 1;
  return 0;
}

/**
 * Append-only, convergent log of named document versions with a Lamport clock.
 *
 * Ordering is `(lamport, siteId)`; entries are de-duplicated by `id` so a replayed
 * entry during resync is never appended twice (REQ-COLLAB-048).
 */
export class VersionLog {
  private readonly items = new Map<string, VersionEntry>();
  private _lamport = 0;

  constructor(private readonly siteId: string) {}

  /** Current Lamport clock value. */
  get lamport(): number {
    return this._lamport;
  }

  /** All entries in deterministic `(lamport, siteId)` order. */
  entries(): VersionEntry[] {
    return [...this.items.values()].sort(compareEntries);
  }

  /**
   * Save the current document snapshot as a new named version. Increments the
   * local Lamport clock (REQ-COLLAB-040, REQ-COLLAB-044).
   */
  save(label: string, snapshotBytes: Uint8Array): VersionEntry {
    this._lamport += 1;
    const entry: VersionEntry = {
      id: crypto.randomUUID(),
      label,
      snapshotBytes,
      siteId: this.siteId,
      lamport: this._lamport,
    };
    this.items.set(entry.id, entry);
    return entry;
  }

  /**
   * Merge a version entry received from a peer. De-duplicates by `id` and advances
   * the Lamport clock to `max(local, remote) + 1` (REQ-COLLAB-044, REQ-COLLAB-048).
   */
  receive(entry: VersionEntry): void {
    if (this.items.has(entry.id)) return;
    this._lamport = Math.max(this._lamport, entry.lamport) + 1;
    this.items.set(entry.id, entry);
  }

  /** Return a version's snapshot bytes by id, or `null` if unknown. */
  restore(id: string): Uint8Array | null {
    return this.items.get(id)?.snapshotBytes ?? null;
  }

  /** Look up a full entry by id. */
  get(id: string): VersionEntry | undefined {
    return this.items.get(id);
  }

  /** Whether an entry with the given id is already present. */
  has(id: string): boolean {
    return this.items.has(id);
  }
}

/**
 * Encode a {@link VersionEntry} to a compact binary frame for transmission over
 * the trystero DataChannel: a 4-byte big-endian header length, a JSON metadata
 * header, then the raw snapshot bytes appended verbatim. Chosen over
 * base64-in-JSON so large snapshots stay binary and auto-chunk efficiently
 * (approved decision 2).
 */
export function encodeVersionEntry(entry: VersionEntry): ArrayBuffer {
  const header = JSON.stringify({
    id: entry.id,
    label: entry.label,
    siteId: entry.siteId,
    lamport: entry.lamport,
  });
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(4 + headerBytes.length + entry.snapshotBytes.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(entry.snapshotBytes, 4 + headerBytes.length);
  return out.buffer;
}

/** Decode a binary frame produced by {@link encodeVersionEntry}. */
export function decodeVersionEntry(buffer: ArrayBuffer): VersionEntry {
  const arr = new Uint8Array(buffer);
  const headerLen = new DataView(arr.buffer, arr.byteOffset, arr.byteLength).getUint32(
    0,
    false,
  );
  const header = JSON.parse(
    new TextDecoder().decode(arr.subarray(4, 4 + headerLen)),
  ) as Omit<VersionEntry, "snapshotBytes">;
  const snapshotBytes = arr.slice(4 + headerLen);
  return { ...header, snapshotBytes };
}
