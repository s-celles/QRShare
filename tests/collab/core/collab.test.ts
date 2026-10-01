import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { CollabSession, colorOf, createIdentity, decodeVersionEntry, encodeVersionEntry, restoreShared, setText, VersionLog } from "@/collab/core";
import { MockNetwork, MockRoom } from "./mock";

function group(n: number) {
  const net = new MockNetwork();
  const sessions = Array.from({ length: n }, (_, i) => {
    const id = String.fromCharCode(65 + i);
    return new CollabSession(new MockRoom(id, net), { siteId: id, identity: { name: `Peer ${id}`, color: "#000000" } });
  });
  return { net, sessions };
}

describe("identity", () => {
  it("builds compound names whose colour matches the colour word", () => {
    const a = createIdentity(42);
    expect(a).toEqual(createIdentity(42));
    expect(a.name.split(" ")).toHaveLength(3);
    expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorOf("Swift Crimson Falcon")).toBe("#b8173a");
    expect(colorOf("nobody")).toBe("#2a78d6");
  });
});

describe("document sync", () => {
  it("converges three peers, including one that joins late", () => {
    const { net, sessions } = group(3);
    const [a, b, c] = sessions as [CollabSession, CollabSession, CollabSession];
    a.doc.getMap("cells").set("A1", 1);
    net.connectAll();
    expect(b.doc.getMap("cells").get("A1")).toBe(1);
    expect(c.doc.getMap("cells").get("A1")).toBe(1);
    b.doc.getMap("cells").set("B2", "x");
    setText(c.doc.getText("t"), "hello");
    for (const s of sessions) expect(s.doc.getMap("cells").toJSON()).toEqual({ A1: 1, B2: "x" });
    expect(a.doc.getText("t").toString()).toBe("hello");
  });

  it("catches up after being offline, in both directions", () => {
    const { net, sessions } = group(2);
    const [a, b] = sessions as [CollabSession, CollabSession];
    net.connectAll();
    net.disconnect(net.rooms[1]!);
    a.doc.getText("t").insert(0, "from A ");
    b.doc.getText("t").insert(0, "from B ");
    net.connectAll();
    expect(a.doc.getText("t").toString()).toBe(b.doc.getText("t").toString());
    expect(a.doc.getText("t").toString()).toContain("from A");
    expect(a.doc.getText("t").toString()).toContain("from B");
  });
});

describe("presence", () => {
  it("shows who is here with their cursor, and forgets peers that leave", () => {
    const { net, sessions } = group(3);
    const [a, b] = sessions as [CollabSession, CollabSession];
    net.connectAll();
    b.setCursor({ row: 2, col: 3 });
    const seen = a.participants;
    expect(seen.map((p) => p.user.name)).toEqual(["Peer A", "Peer B", "Peer C"]);
    expect(seen[0]!.self).toBe(true);
    expect(seen.find((p) => p.user.name === "Peer B")!.cursor).toEqual({ row: 2, col: 3 });
    b.setIdentity({ name: "Bold Teal Otter", color: "#0b7a7a" });
    expect(a.participants.map((p) => p.user.name)).toContain("Bold Teal Otter");
    net.disconnect(net.rooms[1]!);
    expect(a.participants.map((p) => p.user.name)).toEqual(["Peer A", "Peer C"]);
  });
});

describe("version history", () => {
  it("shares saved versions with authors, replays them to late joiners, and restores", () => {
    const { net, sessions } = group(3);
    const [a, b, c] = sessions as [CollabSession, CollabSession, CollabSession];
    net.rooms[0]!.peers.add("B");
    net.rooms[1]!.peers.add("A");
    net.rooms[0]!.join!("B");
    net.rooms[1]!.join!("A");
    setText(a.doc.getText("t"), "first draft");
    a.doc.getMap("m").set("k", 1);
    const v1 = a.saveVersion("Draft");
    expect(b.versions.map((v) => [v.label, v.author])).toEqual([["Draft", "Peer A"]]);
    setText(b.doc.getText("t"), "second draft");
    b.doc.getMap("m").set("k", 2);
    b.doc.getMap("m").set("extra", true);
    // C joins later and receives everything, history included.
    net.connectAll();
    expect(c.versions.map((v) => v.id)).toEqual([v1.id]);
    expect(c.doc.getText("t").toString()).toBe("second draft");
    // Restoring is a new edit that reaches everyone.
    expect(c.restoreVersion(v1.id, { t: "text", m: "map" })).toBe(true);
    for (const s of sessions) {
      expect(s.doc.getText("t").toString()).toBe("first draft");
      expect(s.doc.getMap("m").toJSON()).toEqual({ k: 1 });
    }
    const old = a.versionDoc(v1.id)!;
    expect(old.getText("t").toString()).toBe("first draft");
  });

  it("frames entries with their metadata and stays readable without it", () => {
    const log = new VersionLog("A");
    const e = log.save("x", new Uint8Array([1, 2, 3]), { author: "Ada", auto: true });
    const back = decodeVersionEntry(encodeVersionEntry(e));
    expect(back).toEqual(e);
    // An entry framed by an older peer (no author / date) still decodes.
    const legacy = { id: "l", label: "old", siteId: "Z", lamport: 9 };
    const header = new TextEncoder().encode(JSON.stringify(legacy));
    const buf = new Uint8Array(4 + header.length + 1);
    new DataView(buf.buffer).setUint32(0, header.length);
    buf.set(header, 4);
    buf[4 + header.length] = 7;
    expect(decodeVersionEntry(buf.buffer)).toEqual({ ...legacy, snapshotBytes: new Uint8Array([7]) });
  });

  it("restores arrays and removes keys added since", () => {
    const target = new Y.Doc();
    target.getArray("a").insert(0, [1, 2, 3]);
    target.getMap("m").set("new", 1);
    const source = new Y.Doc();
    source.getArray("a").insert(0, [9]);
    restoreShared(target, source, { a: "array", m: "map" });
    expect(target.getArray("a").toJSON()).toEqual([9]);
    expect(target.getMap("m").toJSON()).toEqual({});
  });
});
