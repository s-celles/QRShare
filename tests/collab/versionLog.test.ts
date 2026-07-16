import { describe, expect, it } from "bun:test";
import { CollabDoc } from "@/collab/doc";
import {
  VersionLog,
  encodeVersionEntry,
  decodeVersionEntry,
  type VersionEntry,
} from "@/collab/versionLog";

function entry(partial: Partial<VersionEntry>): VersionEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    label: partial.label ?? "v",
    snapshotBytes: partial.snapshotBytes ?? new Uint8Array([1, 2, 3]),
    siteId: partial.siteId ?? "site",
    lamport: partial.lamport ?? 1,
  };
}

describe("VersionLog", () => {
  it("saves entries and increments the Lamport clock locally", () => {
    const log = new VersionLog("A");
    const snap = new Uint8Array([9, 9]);
    const e1 = log.save("first", snap);
    const e2 = log.save("second", snap);
    expect(e1.lamport).toBe(1);
    expect(e2.lamport).toBe(2);
    expect(e1.siteId).toBe("A");
    expect(e1.label).toBe("first");
  });

  it("de-duplicates entries by id when the same entry is received twice", () => {
    const log = new VersionLog("A");
    const remote = entry({ id: "dup", siteId: "B", lamport: 5 });
    log.receive(remote);
    log.receive({ ...remote });
    expect(log.entries().filter((e) => e.id === "dup")).toHaveLength(1);
  });

  it("orders entries by (lamport, siteId) and not by insertion order", () => {
    const log = new VersionLog("A");
    log.receive(entry({ id: "x", siteId: "Z", lamport: 3 }));
    log.receive(entry({ id: "y", siteId: "A", lamport: 3 }));
    log.receive(entry({ id: "z", siteId: "M", lamport: 1 }));
    const order = log.entries().map((e) => e.id);
    // lamport 1 first (z), then lamport 3 tie broken by siteId: A (y) before Z (x)
    expect(order).toEqual(["z", "y", "x"]);
  });

  it("updates the Lamport clock to max(local, remote) + 1 on receive", () => {
    const log = new VersionLog("A");
    log.save("local", new Uint8Array([0])); // lamport now 1
    log.receive(entry({ id: "r", siteId: "B", lamport: 10 }));
    // max(1, 10) + 1 = 11 -> next local save is 12
    const next = log.save("after", new Uint8Array([0]));
    expect(next.lamport).toBe(12);
  });

  it("restores an entry's snapshot bytes by id", () => {
    const log = new VersionLog("A");
    const snap = new Uint8Array([4, 5, 6]);
    const saved = log.save("restorable", snap);
    const restored = log.restore(saved.id);
    expect(restored).toEqual(snap);
    expect(log.restore("missing")).toBeNull();
  });

  it("is append-only: restoring does not remove later versions", () => {
    const log = new VersionLog("A");
    const first = log.save("first", new Uint8Array([1]));
    log.save("second", new Uint8Array([2]));
    log.restore(first.id);
    expect(log.entries()).toHaveLength(2);
  });
});

describe("VersionLog snapshot integration", () => {
  it("saves a real document snapshot that can be re-applied", () => {
    const doc = new CollabDoc();
    doc.setText("checkpoint one");
    const log = new VersionLog("A");
    const saved = log.save("cp1", doc.encodeSnapshot());

    const fresh = new CollabDoc();
    const bytes = log.restore(saved.id)!;
    fresh.applySnapshot(bytes);
    expect(fresh.text).toBe("checkpoint one");
  });
});

describe("VersionEntry binary framing", () => {
  it("round-trips an entry through binary encode/decode (not base64/JSON)", () => {
    const original = entry({
      id: "abc",
      label: "my label",
      siteId: "peer-1",
      lamport: 7,
      snapshotBytes: new Uint8Array([10, 20, 30, 40]),
    });
    const buf = encodeVersionEntry(original);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    const decoded = decodeVersionEntry(buf);
    expect(decoded.id).toBe(original.id);
    expect(decoded.label).toBe(original.label);
    expect(decoded.siteId).toBe(original.siteId);
    expect(decoded.lamport).toBe(original.lamport);
    expect(decoded.snapshotBytes).toEqual(original.snapshotBytes);
  });
});
