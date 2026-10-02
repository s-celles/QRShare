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
export declare class MemoryImportLog implements ImportLog {
    private readonly entries;
    add(entry: ImportLogEntry): Promise<void>;
    list(docId?: string): Promise<ImportLogEntry[]>;
}
