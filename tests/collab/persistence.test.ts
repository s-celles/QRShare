import { describe, expect, it } from "bun:test";
import {
  isPersistenceAvailable,
  attachDocPersistence,
  loadVersionEntries,
  saveVersionEntry,
} from "@/collab/persistence";
import { CollabDoc } from "@/collab/doc";

// The bun test runtime has no IndexedDB, so persistence must degrade to a no-op
// rather than throw (REQ-COLLAB-063: reload behavior is well-defined either way).
describe("collab persistence graceful fallback", () => {
  it("reports IndexedDB as unavailable in this runtime", () => {
    expect(isPersistenceAvailable()).toBe(false);
  });

  it("attachDocPersistence resolves to null without IndexedDB", async () => {
    const doc = new CollabDoc();
    await expect(attachDocPersistence("room-x", doc)).resolves.toBeNull();
  });

  it("version-log persistence no-ops without IndexedDB", async () => {
    await expect(
      saveVersionEntry("room-x", {
        id: "1",
        label: "v",
        snapshotBytes: new Uint8Array([1]),
        siteId: "A",
        lamport: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(loadVersionEntries("room-x")).resolves.toEqual([]);
  });
});
