/** A local log of the updates received from other devices. */
export class MemoryImportLog {
    entries = [];
    async add(entry) {
        this.entries.push(entry);
    }
    async list(docId) {
        return this.entries.filter((e) => !docId || e.docId === docId);
    }
}
