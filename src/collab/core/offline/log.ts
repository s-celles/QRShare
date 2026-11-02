/** A local log of the updates received from other devices. */

export interface ImportLogEntry {
  at: number;
  docId: string;
  /** Hex id of the sender, and its name when it is a trusted peer. */
  peer: string;
  peerName?: string;
  trust: "trusted" | "unknown";
  bytes: number;
  result: "applied" | "unchanged" | "refused" | "rejected";
  reason?: string;
}

export interface ImportLog {
  add(entry: ImportLogEntry): Promise<void>;
  list(docId?: string): Promise<ImportLogEntry[]>;
}

export class MemoryImportLog implements ImportLog {
  private readonly entries: ImportLogEntry[] = [];
  async add(entry: ImportLogEntry) {
    this.entries.push(entry);
  }
  async list(docId?: string) {
    return this.entries.filter((e) => !docId || e.docId === docId);
  }
}
