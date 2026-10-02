import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { offline } from "@/collab/core";

const { FrameError, FrameType, MemoryImportLog, MemoryPeerStore, OfflineSync, decodeFrame, encodeFrame, generatePeerKey, applyValidated, updateFor, stateVector, toHex } = offline;

const DOC_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

async function device(name: string, text = "") {
  const doc = new Y.Doc();
  if (text) doc.getText("t").insert(0, text);
  const key = await generatePeerKey();
  const peers = new MemoryPeerStore();
  const log = new MemoryImportLog();
  const sync = new OfflineSync({ doc, docId: DOC_ID, key, name, peers, log });
  return { name, doc, key, peers, log, sync, text: () => doc.getText("t").toString() };
}
type Device = Awaited<ReturnType<typeof device>>;

/** A pulls from B: A shows its state vector, B shows the reply, A applies it. */
async function pull(a: Device, b: Device): Promise<boolean> {
  const sv = await a.sync.stateVector();
  const answer = await b.sync.receive(sv);
  if (answer.type !== "stateVector") throw new Error("expected a state vector");
  const got = await a.sync.receive(answer.reply);
  if (got.type !== "update") throw new Error("expected an update");
  return (await got.apply()).changed;
}

/** Each device trusts the other after exchanging HELLO frames. */
async function introduce(a: Device, b: Device) {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const hello = await y.sync.receive(await x.sync.hello());
    if (hello.type !== "hello") throw new Error("expected hello");
    await y.peers.put(hello.peer);
  }
}

describe("offline sync: frames", () => {
  it("encodes and decodes every field, compressed and signed", async () => {
    const key = await generatePeerKey();
    const payload = new TextEncoder().encode("x".repeat(500));
    const bytes = await encodeFrame({ type: FrameType.UPDATE, docId: DOC_ID, senderId: key.id, payload }, { signWith: key.privateKey });
    const back = await decodeFrame(bytes);
    expect(back.type).toBe(FrameType.UPDATE);
    expect(back.docId).toBe(DOC_ID);
    expect(toHex(back.senderId)).toBe(toHex(key.id));
    expect(back.payload).toEqual(payload);
    expect(back.compressed).toBe(true);
    expect(back.signature?.length).toBe(64);
    expect(bytes.length).toBeLessThan(200);
  });

  it("rejects unknown versions, truncated and oversized frames", async () => {
    const key = await generatePeerKey();
    const bytes = await encodeFrame({ type: FrameType.STATE_VECTOR, docId: DOC_ID, senderId: key.id, payload: new Uint8Array(10) }, { compress: false });
    const wrongVersion = bytes.slice();
    wrongVersion[4] = 9;
    await expect(decodeFrame(wrongVersion)).rejects.toMatchObject({ code: "version" });
    await expect(decodeFrame(bytes.slice(0, bytes.length - 3))).rejects.toMatchObject({ code: "truncated" });
    await expect(decodeFrame(bytes.slice(0, 20))).rejects.toMatchObject({ code: "truncated" });
    const notAFrame = bytes.slice();
    notAFrame[0] = 0;
    await expect(decodeFrame(notAFrame)).rejects.toMatchObject({ code: "format" });
    // The announced length is checked before anything is decoded.
    const huge = bytes.slice();
    new DataView(huge.buffer).setUint32(40, 100 * 1024 * 1024);
    await expect(decodeFrame(huge)).rejects.toMatchObject({ code: "tooLarge" });
    const big = await encodeFrame({ type: FrameType.UPDATE, docId: DOC_ID, senderId: key.id, payload: new Uint8Array(2000).fill(7) }, { compress: true });
    await expect(decodeFrame(big, { maxBytes: 1000 })).rejects.toMatchObject({ code: "tooLarge" }); // limit on the decompressed payload too
  });
});

describe("offline sync: convergence", () => {
  it("makes two devices converge, whatever the order", async () => {
    const a = await device("A", "hello");
    const b = await device("B");
    await pull(b, a);
    expect(b.text()).toBe("hello");
    a.doc.getText("t").insert(5, " world");
    b.doc.getText("t").insert(0, ">> ");
    await pull(a, b);
    await pull(b, a);
    expect(a.text()).toBe(b.text());
    expect(a.text()).toBe(">> hello world");
  });

  it("makes three devices converge after syncs in any order", async () => {
    for (const order of [["ab", "bc", "ca", "ab", "bc"], ["cb", "ba", "ac", "cb", "ba"], ["ac", "ab", "ca", "ba", "cb", "bc"]]) {
      const a = await device("A", "base");
      const b = await device("B");
      const c = await device("C");
      await pull(b, a);
      await pull(c, a);
      a.doc.getText("t").insert(0, "A1 ");
      b.doc.getText("t").insert(4, " B1");
      c.doc.getText("t").delete(0, 1);
      c.doc.getText("t").insert(0, "C");
      const d = { a, b, c } as Record<string, Device>;
      for (const step of order) await pull(d[step[0]!]!, d[step[1]!]!);
      expect(new Set([a.text(), b.text(), c.text()]).size).toBe(1);
      expect(a.text()).toContain("A1");
      expect(a.text()).toContain("B1");
    }
  });

  it("changes nothing when the same update is applied again", async () => {
    const a = await device("A", "hello");
    const b = await device("B");
    const sv = await b.sync.stateVector();
    const answer = await a.sync.receive(sv);
    if (answer.type !== "stateVector") throw new Error();
    for (const expected of [true, false, false]) {
      const got = await b.sync.receive(answer.reply);
      if (got.type !== "update") throw new Error();
      expect((await got.apply()).changed).toBe(expected);
    }
    expect(b.text()).toBe("hello");
    expect((await b.log.list()).map((e) => e.result)).toEqual(["applied", "unchanged", "unchanged"]);
    // An update made only of deletions is noticed as a change.
    b.doc.getText("t").delete(0, 1);
    expect(await pull(a, b)).toBe(true);
    expect(a.text()).toBe("ello");
  });

  it("validates updates on an isolated copy before applying them", async () => {
    const a = await device("A", "ok");
    const doc = new Y.Doc();
    const update = updateFor(a.doc, stateVector(doc));
    expect(() => applyValidated(doc, update, (copy) => {
      if (copy.getText("t").toString() === "ok") throw new Error("not allowed");
    })).toThrow(FrameError);
    expect(doc.getText("t").toString()).toBe("");
    expect(() => applyValidated(doc, new Uint8Array([1, 2, 3, 250]))).toThrow(FrameError);
    expect(doc.getText("t").toString()).toBe("");
  });
});

describe("offline sync: trust", () => {
  it("accepts unknown peers as unknown, checks the signature of known ones", async () => {
    const a = await device("Ana", "secret plan");
    const b = await device("Bob");
    const sv = await b.sync.stateVector();
    const first = await a.sync.receive(sv);
    expect(first.type).toBe("stateVector");
    const unknown = await b.sync.receive((first as { reply: Uint8Array }).reply);
    expect(unknown).toMatchObject({ type: "update", trust: "unknown" });

    await introduce(a, b);
    const trusted = await b.sync.receive((await a.sync.receive(await b.sync.stateVector()) as { reply: Uint8Array }).reply);
    expect(trusted).toMatchObject({ type: "update", trust: "trusted", peer: { name: "Ana" } });

    // A frame claiming to be from Ana but signed by someone else, or unsigned, is rejected and logged.
    const mallory = await generatePeerKey();
    const forged = await encodeFrame({ type: FrameType.UPDATE, docId: DOC_ID, senderId: a.key.id, payload: updateFor(a.doc, new Uint8Array([0])) }, { signWith: mallory.privateKey });
    await expect(b.sync.receive(forged)).rejects.toMatchObject({ code: "signature" });
    const unsigned = await encodeFrame({ type: FrameType.UPDATE, docId: DOC_ID, senderId: a.key.id, payload: updateFor(a.doc, new Uint8Array([0])) });
    await expect(b.sync.receive(unsigned)).rejects.toMatchObject({ code: "signature" });
    expect((await b.log.list()).filter((e) => e.result === "rejected")).toHaveLength(2);
  });

  it("refuses a HELLO whose key does not sign it, and frames for another document", async () => {
    const a = await device("A");
    const other = await generatePeerKey();
    const hello = await encodeFrame({ type: FrameType.HELLO, docId: DOC_ID, senderId: a.key.id, payload: offline.helloPayload(a.key.publicKey, "A") }, { signWith: other.privateKey });
    const b = await device("B");
    await expect(b.sync.receive(hello)).rejects.toMatchObject({ code: "signature" });
    const elsewhere = await encodeFrame({ type: FrameType.STATE_VECTOR, docId: "00000000-0000-4000-8000-000000000000", senderId: a.key.id, payload: new Uint8Array([0]) });
    await expect(b.sync.receive(elsewhere)).rejects.toMatchObject({ code: "invalid" });
  });
});
