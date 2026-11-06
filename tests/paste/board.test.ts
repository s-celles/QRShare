import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_LIMITS, PasteBoard, type BoardLimits, type Paste } from "@/paste/board";
import { FrameType, encodeBlob, encodeIdList, encodeProof, sealFrame } from "@/paste/frames";
import { createAuthor, deriveRoomKeys, toHex } from "@/paste/keys";
import { newOtsFile, parseOtsFile, proofSummary, serializeOtsFile } from "@/paste/ots/file";
import { addOp } from "@/paste/ots/timestamp";
import { encodeStatement, sealItem } from "@/paste/statement";
import { PasteMockNet, PasteMockRoom, settle, until } from "./mock";
import { SECRET, roomKeys, sha256 } from "./helpers";

const MIN = 60_000;
let clock = 1_800_000_000_000;
const now = () => clock;
const boards: PasteBoard[] = [];

afterEach(() => {
  boards.splice(0).forEach((b) => b.destroy());
});

async function board(room: PasteMockRoom, opts: { limits?: Partial<BoardLimits>; clock?: () => number } = {}) {
  const author = await createAuthor();
  const b = new PasteBoard(room, { keys: await roomKeys(), author: author.key, now: opts.clock ?? now, autoTick: false, limits: opts.limits });
  boards.push(b);
  return b;
}

async function mesh(n: number, opts: { limits?: Partial<BoardLimits> } = {}) {
  const net = new PasteMockNet();
  const rooms = Array.from({ length: n }, (_, i) => net.room(`peer${i}`));
  const bs = await Promise.all(rooms.map((r) => board(r, opts)));
  return { net, rooms, boards: bs };
}

async function post(b: PasteBoard, source: string, attachments: { bytes: Uint8Array; name?: string; width?: number }[] = []) {
  clock += 3_000;
  const result = await b.post({
    format: "markdown",
    source,
    attachments: attachments.map((a) => ({ bytes: a.bytes, mime: a.width ? "image/webp" : "application/octet-stream", name: a.name ?? "file.bin", width: a.width ?? 0, height: a.width ?? 0 })),
  });
  if ("error" in result) throw new Error(result.error);
  return result;
}

async function pendingProof(id: Uint8Array, uri: string, nonce = 1): Promise<Uint8Array> {
  const file = newOtsFile(id);
  const node = await addOp(await addOp(file.timestamp, { kind: "append", arg: new Uint8Array(16).fill(nonce) }), { kind: "sha256" });
  node.attestations.push({ kind: "pending", uri });
  return serializeOtsFile(file);
}

const ids = (b: PasteBoard) => b.pastes().map((p) => toHex(p.id));

describe("REQ-PASTE-052 / REQ-PASTE-054 posting", () => {
  it("sends a paste to every connected peer and marks it as own on the author's device", async () => {
    const { net, boards: [a, b, c] } = await mesh(3);
    net.connectAll();
    const p = await post(a, "# hello");
    await until(() => b.pastes().length === 1 && c.pastes().length === 1);
    expect(a.pastes()[0].own).toBe(true);
    expect(b.pastes()[0].own).toBe(false);
    expect(toHex(b.pastes()[0].id)).toBe(toHex(p.id));
    expect(b.pastes()[0].source).toBe("# hello");
    expect(b.pastes()[0].authorFp).toBe(a.pastes()[0].authorFp);
    expect(toHex(p.id)).toBe(toHex(await sha256(p.statement)));
  });

  it("ignores duplicates", async () => {
    const { net, rooms, boards: [a, b] } = await mesh(2);
    net.connectAll();
    const p = await post(a, "once");
    await until(() => b.pastes().length === 1);
    const keys = await roomKeys();
    const item = new Uint8Array([...p.statement, ...p.signature]);
    const frame = await sealFrame(keys.contentKey, FrameType.ITEM, item);
    rooms[1].inject("paste", frame.buffer as ArrayBuffer, "peer0");
    rooms[1].inject("paste", frame.buffer as ArrayBuffer, "peer0");
    await settle();
    expect(b.pastes().length).toBe(1);
  });

  it("REQ-PASTE-055 orders by declared timestamp, newest first, ties by id", async () => {
    const { net, boards: [a, b] } = await mesh(2);
    net.connectAll();
    const first = await post(a, "first");
    const second = await post(a, "second");
    await until(() => b.pastes().length === 2);
    expect(b.pastes().map((p) => p.source)).toEqual(["second", "first"]);
    expect(ids(a)).toEqual([toHex(second.id), toHex(first.id)]);
    // ties
    const fixed = () => 1_000;
    const x = await board(new PasteMockNet().room("x"), { clock: fixed });
    const p1 = await x.post({ format: "text", source: "a", attachments: [] });
    const y = await board(new PasteMockNet().room("y"), { clock: fixed });
    const p2 = await y.post({ format: "text", source: "b", attachments: [] });
    const sorted = [p1, p2].map((p) => toHex((p as Paste).id)).sort();
    const z = await board(new PasteMockNet().room("z"), { clock: fixed });
    for (const p of [p2, p1] as Paste[]) await z.receiveItem(new Uint8Array([...p.statement, ...p.signature]), "x");
    expect(ids(z)).toEqual(sorted);
  });
});

describe("REQ-PASTE-051 / REQ-PASTE-053 synchronisation", () => {
  it("sends the board and its proofs to a late joiner", async () => {
    const net = new PasteMockNet();
    const [ra, rb, rc] = ["a", "b", "c"].map((id) => net.room(id));
    const a = await board(ra);
    const b = await board(rb);
    net.link(ra, rb);
    const p1 = await post(a, "one");
    await post(b, "two");
    expect(await a.attachProof(p1.id, await pendingProof(p1.id, "https://alice.btc.calendar.opentimestamps.org"))).toBe("shared");
    await until(() => a.pastes().length === 2 && b.pastes().length === 2 && !!b.pastes().find((p) => p.source === "one")?.proof);
    const c = await board(rc);
    net.link(rc, ra);
    await until(() => c.pastes().length === 2 && !!c.pastes().find((p) => p.source === "one")?.proof);
    expect(c.pastes().find((p) => p.source === "one")!.proofStatus).toBe("pending");
  });

  it("converges on a partial mesh through periodic digests", async () => {
    const net = new PasteMockNet();
    const [ra, rb, rc] = ["a", "b", "c"].map((id) => net.room(id));
    const [a, b, c] = [await board(ra), await board(rb), await board(rc)];
    net.link(ra, rb);
    net.link(rb, rc);
    await post(a, "from a");
    await until(() => b.pastes().length === 1);
    await settle();
    expect(c.pastes().length).toBe(0); // no relay of broadcasts
    clock += 20_000;
    [a, b, c].forEach((x) => x.tick());
    await until(() => c.pastes().length === 1);
    await post(c, "from c");
    clock += 20_000;
    [a, b, c].forEach((x) => x.tick());
    await until(() => a.pastes().length === 2);
  });

  it("REQ-PASTE-050 forgets the board once every holder has left", async () => {
    const net = new PasteMockNet();
    const [ra, rb] = ["a", "b"].map((id) => net.room(id));
    const [a, b] = [await board(ra), await board(rb)];
    net.link(ra, rb);
    await post(a, "ephemeral");
    await until(() => b.pastes().length === 1);
    a.destroy();
    b.destroy();
    net.leave(ra);
    net.leave(rb);
    expect(a.pastes()).toEqual([]);
    const [rc, rd] = ["c", "d"].map((id) => net.room(id));
    const [c, d] = [await board(rc), await board(rd)];
    net.link(rc, rd);
    await settle();
    expect(c.pastes()).toEqual([]);
    expect(d.pastes()).toEqual([]);
  });

  it("keeps everything in memory only", async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { localStorage: g.localStorage, indexedDB: g.indexedDB };
    const trap = new Proxy({}, { get: () => { throw new Error("storage used"); } });
    g.localStorage = trap;
    g.indexedDB = trap;
    try {
      const { net, boards: [a, b] } = await mesh(2);
      net.connectAll();
      await post(a, "x", [{ bytes: new Uint8Array([1, 2, 3]) }]);
      await until(() => b.pastes().length === 1 && b.attachment(b.pastes()[0].attachments[0].hash) instanceof Uint8Array);
    } finally {
      g.localStorage = saved.localStorage;
      g.indexedDB = saved.indexedDB;
    }
  });
});

describe("REQ-PASTE-036 / 037 / 038 attachments", () => {
  it("fetches attachments from the sender, verified against the signed list", async () => {
    const { net, boards: [a, b] } = await mesh(2);
    net.connectAll();
    const bytes = new Uint8Array(50_000).map((_, i) => i % 251);
    const p = await post(a, "see file", [{ bytes, name: "data.bin" }]);
    expect(a.attachment(p.attachments[0].hash)).toEqual(bytes);
    await until(() => b.pastes().length === 1);
    await until(() => b.attachment(p.attachments[0].hash) instanceof Uint8Array);
    expect(b.attachment(p.attachments[0].hash)).toEqual(bytes);
  });

  it("asks another holder after a timeout, and reports unavailable without holders", async () => {
    const net = new PasteMockNet();
    const [ra, rb, rc] = ["a", "b", "c"].map((id) => net.room(id));
    const [a, b, c] = [await board(ra), await board(rb), await board(rc)];
    net.link(ra, rb);
    const p = await post(a, "file", [{ bytes: new Uint8Array([4, 5, 6]) }]);
    const hash = p.attachments[0].hash;
    await until(() => b.attachment(hash) instanceof Uint8Array);
    ra.drop.add("pblob"); // the author stops answering
    net.link(rc, ra);
    await until(() => c.pastes().length === 1);
    await settle();
    expect(c.attachment(hash)).toBe("loading");
    net.link(rc, rb); // b holds the paste and announces it
    await settle();
    clock += 15_000;
    c.tick();
    await until(() => c.attachment(hash) instanceof Uint8Array);

    // a fourth peer that only reaches a silent author
    const rd = net.room("d");
    const d = await board(rd);
    net.link(rd, ra);
    await until(() => d.pastes().length === 1);
    clock += 15_000;
    d.tick();
    await settle();
    net.unlink(rd, ra);
    await settle();
    expect(d.attachment(hash)).toBe("unavailable");
  });

  it("rejects an attachment whose hash or size does not match, with a strike", async () => {
    const { net, rooms, boards: [a, b] } = await mesh(2);
    net.connectAll();
    rooms[0].drop.add("pblob");
    const p = await post(a, "f", [{ bytes: new Uint8Array([1, 2, 3]) }]);
    await until(() => b.pastes().length === 1);
    const keys = await roomKeys();
    const forged = await sealFrame(keys.contentKey, FrameType.BLOB, encodeBlob(p.attachments[0].hash, new Uint8Array([1, 2, 4])));
    rooms[1].inject("pblob", forged.buffer as ArrayBuffer, "peer0");
    await settle();
    expect(b.attachment(p.attachments[0].hash)).toBe("loading");
    expect(b.strikes("peer0")).toBe(1);
  });

  it("answers attachment requests only for hashes listed by held pastes", async () => {
    const { net, rooms, boards: [a] } = await mesh(2);
    net.connectAll();
    await post(a, "f", [{ bytes: new Uint8Array([1]) }]);
    await settle();
    const before = rooms[0].sent.filter((s) => s.action === "pblob").length;
    const keys = await roomKeys();
    const want = await sealFrame(keys.contentKey, FrameType.BLOB_WANT, encodeIdList([await sha256(new Uint8Array([2]))]));
    rooms[0].inject("paste", want.buffer as ArrayBuffer, "peer1");
    await settle();
    expect(rooms[0].sent.filter((s) => s.action === "pblob").length).toBe(before);
  });
});

describe("REQ-PASTE-070..076 limits and abuse handling", () => {
  it("uses the specified default limits", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxPastes: 500,
      maxTextBytes: 4 * 1024 * 1024,
      maxAttachmentBytes: 32 * 1024 * 1024,
      maxPastesPerAuthor: 50,
      maxAttachmentBytesPerAuthor: 8 * 1024 * 1024,
      postIntervalMs: 3_000,
      replyBytesBurst: 8 * 1024 * 1024,
      replyBytesPerSecond: 1024 * 1024,
    });
  });

  it("refuses oversize sources, too many or too large attachments", async () => {
    const x = await board(new PasteMockNet().room("x"));
    clock += 3_000;
    expect(await x.post({ format: "text", source: "x".repeat(16 * 1024 + 1), attachments: [] })).toEqual({ error: "too-large" });
    const att = (size: number, width = 0) => ({ bytes: new Uint8Array(size), mime: "application/octet-stream", name: "a.bin", width, height: width });
    expect(await x.post({ format: "text", source: "x", attachments: [1, 2, 3, 4, 5].map(() => att(1)) })).toEqual({ error: "too-many-attachments" });
    expect(await x.post({ format: "text", source: "x", attachments: [att(1.5 * 1024 * 1024 + 1, 10)] })).toEqual({ error: "too-large" });
    expect(await x.post({ format: "text", source: "x", attachments: [att(5 * 1024 * 1024 + 1)] })).toEqual({ error: "too-large" });
    expect("id" in (await x.post({ format: "text", source: "x".repeat(16 * 1024), attachments: [att(5 * 1024 * 1024)] }))).toBe(true);
  });

  it("REQ-PASTE-074 lets the user post at most once every 3 seconds", async () => {
    const x = await board(new PasteMockNet().room("x"));
    clock += 3_000;
    expect("id" in (await x.post({ format: "text", source: "1", attachments: [] }))).toBe(true);
    clock += 2_999;
    expect(await x.post({ format: "text", source: "2", attachments: [] })).toEqual({ error: "rate" });
    clock += 1;
    expect("id" in (await x.post({ format: "text", source: "3", attachments: [] }))).toBe(true);
  });

  it("REQ-PASTE-072 refuses new pastes, local and remote, when the board is full, without eviction", async () => {
    const { net, boards: [a, b] } = await mesh(2, { limits: { maxPastes: 3 } });
    net.connectAll();
    let full = false;
    b.on("full", (v) => (full = v));
    for (const s of ["1", "2", "3"]) await post(a, s);
    await until(() => b.pastes().length === 3);
    clock += 3_000;
    expect(await a.post({ format: "text", source: "4", attachments: [] })).toEqual({ error: "full" });
    expect(a.pastes().map((p) => p.source).sort()).toEqual(["1", "2", "3"]);
    // a remote peer with a larger board sends a fourth paste
    const c = await board(net.room("c"));
    net.link(net.rooms[2], net.rooms[1]);
    await post(c, "from c");
    await settle();
    expect(b.pastes().length).toBe(3);
    expect(b.isFull()).toBe(true);
    expect(full).toBe(true);
    expect(b.strikes("c")).toBe(0); // a cap refusal is not a strike
  });

  it("caps text and attachment bytes per board", async () => {
    const t = await board(new PasteMockNet().room("t"), { limits: { maxTextBytes: 10 } });
    await post(t, "12345");
    await post(t, "12345");
    clock += 3_000;
    expect(await t.post({ format: "text", source: "1", attachments: [] })).toEqual({ error: "full" });
    const at = await board(new PasteMockNet().room("at"), { limits: { maxAttachmentBytes: 100 } });
    await post(at, "a", [{ bytes: new Uint8Array(60) }]);
    clock += 3_000;
    expect(await at.post({ format: "text", source: "b", attachments: [{ bytes: new Uint8Array(41), mime: "application/octet-stream", name: "x.bin", width: 0, height: 0 }] })).toEqual({ error: "full" });
  });

  it("REQ-PASTE-073 accepts at most N pastes and bytes per author", async () => {
    const net = new PasteMockNet();
    const [ra, rb] = [net.room("a"), net.room("b")];
    const a = await board(ra);
    const b = await board(rb, { limits: { maxPastesPerAuthor: 2, maxAttachmentBytesPerAuthor: 10 } });
    net.link(ra, rb);
    await post(a, "1");
    await post(a, "2");
    await post(a, "3");
    await settle();
    await until(() => b.pastes().length === 2);
    await settle();
    expect(b.pastes().length).toBe(2);
    const c = await board(net.room("c"), { limits: { maxAttachmentBytesPerAuthor: 10 } });
    await post(c, "1", [{ bytes: new Uint8Array(10) }]);
    clock += 3_000;
    expect(await c.post({ format: "text", source: "2", attachments: [{ bytes: new Uint8Array(1), mime: "application/octet-stream", name: "x.bin", width: 0, height: 0 }] })).toEqual({ error: "full" });
  });

  it("REQ-PASTE-075 drops frames over the size limit or the per-peer budget before decryption", async () => {
    const room = new PasteMockNet().room("x");
    const x = await board(room);
    room.inject("paste", new ArrayBuffer(64 * 1024 + 1), "big");
    room.inject("pblob", new ArrayBuffer(5 * 1024 * 1024 + 1024 + 1), "big");
    await settle();
    expect(x.stats().sizeDrops).toBe(2);
    expect(x.strikes("big")).toBe(0);
    const keys = await roomKeys();
    // distinct frames (identical ones are dropped as duplicates before the budget)
    const invs = await Promise.all(Array.from({ length: 250 }, () => sealFrame(keys.contentKey, FrameType.INV, new Uint8Array(0))));
    for (const inv of invs) room.inject("paste", inv.buffer as ArrayBuffer, "chatty");
    await settle();
    expect(x.stats().budgetDrops).toBe(50);
    expect(x.ignoredCount()).toBe(0);
    for (let i = 0; i < 3; i++) {
      const blob = await sealFrame(keys.contentKey, FrameType.BLOB, encodeBlob(new Uint8Array(32), new Uint8Array(4 * 1024 * 1024)));
      room.inject("pblob", blob.buffer as ArrayBuffer, "heavy");
    }
    await settle();
    expect(x.stats().budgetDrops).toBe(51);
  });

  it("REQ-PASTE-061 / REQ-PASTE-076 ignores a peer after 5 strikes", async () => {
    const { net, rooms, boards: [a, b] } = await mesh(2);
    net.connectAll();
    let ignored = 0;
    b.on("ignored", (n) => (ignored = n));
    for (let i = 0; i < 5; i++) rooms[1].inject("paste", crypto.getRandomValues(new Uint8Array(100)).buffer as ArrayBuffer, "peer0");
    await until(() => b.ignoredCount() === 1);
    expect(ignored).toBe(1);
    await post(a, "too late");
    await settle();
    expect(b.pastes().length).toBe(0);
  });

  it("REQ-PASTE-013 drops an item with an invalid signature and counts a strike", async () => {
    const { rooms, boards: [, b] } = await mesh(2);
    const author = await createAuthor();
    const keys = await roomKeys();
    const statement = encodeStatement({ tag: keys.tag, author: author.key.publicKey, declaredAt: clock, format: "text", source: "forged", attachments: [] });
    const item = await sealItem(statement, author.key.privateKey);
    item[item.length - 1] ^= 1;
    rooms[1].inject("paste", (await sealFrame(keys.contentKey, FrameType.ITEM, item)).buffer as ArrayBuffer, "peer0");
    // a statement of another board
    const other = await deriveRoomKeys(SECRET.map((x) => x + 1));
    const foreign = await sealItem(encodeStatement({ tag: other.tag, author: author.key.publicKey, declaredAt: clock, format: "text", source: "x", attachments: [] }), author.key.privateKey);
    rooms[1].inject("paste", (await sealFrame(keys.contentKey, FrameType.ITEM, foreign)).buffer as ArrayBuffer, "peer0");
    await settle();
    expect(b.pastes().length).toBe(0);
    expect(b.strikes("peer0")).toBe(2);
  });

  it("REQ-PASTE-015 flags pastes dated more than 5 minutes ahead", async () => {
    const net = new PasteMockNet();
    const [ra, rb] = [net.room("a"), net.room("b")];
    let skew = 6 * MIN;
    const a = await board(ra, { clock: () => clock + skew });
    const b = await board(rb);
    net.link(ra, rb);
    await post(a, "from the future");
    await until(() => b.pastes().length === 1);
    skew = 4 * MIN;
    clock += 2 * MIN; // keeps the author's clock moving forward (3 s cool-down)
    await post(a, "slightly ahead");
    await until(() => b.pastes().length === 2);
    expect(b.pastes().find((p) => p.source === "from the future")!.future).toBe(true);
    expect(b.pastes().find((p) => p.source === "slightly ahead")!.future).toBe(false);
    expect(a.pastes().every((p) => !p.future)).toBe(true);
  });
});

describe("REQ-PASTE-084 / REQ-PASTE-085 proofs on the board", () => {
  it("accepts a proof only for the paste it timestamps", async () => {
    const x = await board(new PasteMockNet().room("x"));
    const p = await post(x, "p");
    expect(await x.attachProof(p.id, await pendingProof(new Uint8Array(32), "https://a.pool.opentimestamps.org"))).toBe("invalid");
    expect(await x.attachProof(p.id, new Uint8Array([1, 2, 3]))).toBe("invalid");
    expect(await x.attachProof(new Uint8Array(32), await pendingProof(new Uint8Array(32), "https://a.pool.opentimestamps.org"))).toBe("invalid");
    expect(x.pastes()[0].proofStatus).toBe("none");
    expect(await x.attachProof(p.id, await pendingProof(p.id, "https://a.pool.opentimestamps.org"))).toBe("shared");
    expect(x.pastes()[0].proofStatus).toBe("pending");
    expect(x.pastes()[0].proofSource).toBe("author");
  });

  it("merges the author's successive proofs on every peer", async () => {
    const { net, rooms, boards: [a, b] } = await mesh(2);
    net.connectAll();
    const p = await post(a, "p");
    await until(() => b.pastes().length === 1);
    await a.attachProof(p.id, await pendingProof(p.id, "https://alice.btc.calendar.opentimestamps.org", 1));
    await until(() => !!b.pastes()[0].proof);
    await a.attachProof(p.id, await pendingProof(p.id, "https://finney.calendar.eternitywall.com", 2));
    const calendars = async (x: PasteBoard) => proofSummary(await parseOtsFile(x.pastes()[0].proof!)).calendars.sort();
    await until(() => a.pastes()[0].proof!.length === b.pastes()[0].proof!.length);
    expect(await calendars(a)).toEqual(["https://alice.btc.calendar.opentimestamps.org", "https://finney.calendar.eternitywall.com"]);
    expect(await calendars(b)).toEqual(await calendars(a));

    // an unsigned proof (garbage signature) is refused with a strike
    const keys = await roomKeys();
    const bad = await sealFrame(keys.contentKey, FrameType.PROOF, encodeProof(p.id, new Uint8Array(64), await pendingProof(p.id, "https://a.pool.opentimestamps.org")));
    rooms[1].inject("paste", bad.buffer as ArrayBuffer, "peer0");
    await settle();
    expect(b.strikes("peer0")).toBe(1);
  });
});
