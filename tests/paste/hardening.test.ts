/** Board hardening: author-signed proofs, request amplification, budgets and races. */
import { afterEach, describe, expect, it } from "bun:test";
import { PasteBoard, type BoardLimits } from "@/paste/board";
import { FrameType, encodeBlob, encodeIdList, encodeProof, sealFrame } from "@/paste/frames";
import { createAuthor, type Author } from "@/paste/keys";
import { newOtsFile, parseOtsFile, proofSummary, serializeOtsFile } from "@/paste/ots/file";
import { addOp, allAttestations } from "@/paste/ots/timestamp";
import { signSharedProof } from "@/paste/proof-share";
import { encodeStatement, sealItem, type AttachmentRef } from "@/paste/statement";
import { PasteMockNet, PasteMockRoom, settle, until } from "./mock";
import { roomKeys, sha256 } from "./helpers";

let clock = 1_900_000_000_000;
const now = () => clock;
const boards: PasteBoard[] = [];
afterEach(() => boards.splice(0).forEach((b) => b.destroy()));

async function board(room: PasteMockRoom, limits: Partial<BoardLimits> = {}) {
  const author = await createAuthor();
  const b = new PasteBoard(room, { keys: await roomKeys(), author: author.key, now, autoTick: false, limits });
  boards.push(b);
  return b;
}

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
async function frame(type: FrameType, plain: Uint8Array) {
  return buf(await sealFrame((await roomKeys()).contentKey, type, plain));
}

async function itemFrame(source: string, attachments: AttachmentRef[] = []) {
  const author = await createAuthor();
  const statement = encodeStatement({ tag: (await roomKeys()).tag, author: author.key.publicKey, declaredAt: clock, format: "text", source, attachments });
  return { frame: await frame(FrameType.ITEM, await sealItem(statement, author.key.privateKey)), id: await sha256(statement), author };
}

/** A PROOF frame signed by `signer` (the paste author, or anyone else in attacks). */
async function proofFrame(signer: Author, id: Uint8Array, ots: Uint8Array, sent = ots) {
  const signature = await signSharedProof(signer.key.privateKey, (await roomKeys()).tag, id, ots);
  return frame(FrameType.PROOF, encodeProof(id, signature, sent));
}

async function pendingProof(id: Uint8Array, uris: string[], nonce = 1) {
  const file = newOtsFile(id);
  const root = await addOp(await addOp(file.timestamp, { kind: "append", arg: new Uint8Array(16).fill(nonce) }), { kind: "sha256" });
  for (const [i, uri] of uris.entries()) (await addOp(root, { kind: "append", arg: Uint8Array.of(i + 1) })).attestations.push({ kind: "pending", uri });
  return file;
}

/** Hangs a forged Bitcoin attestation (height 1) under every pending node. */
async function poison(bytes: Uint8Array) {
  const file = await parseOtsFile(bytes);
  for (const a of allAttestations(file.timestamp)) {
    if (a.attestation.kind === "pending") (await addOp(a.node, { kind: "append", arg: Uint8Array.of(0xee) })).attestations.push({ kind: "bitcoin", height: 1 });
  }
  return serializeOtsFile(file);
}

const ALICE = "https://alice.btc.calendar.opentimestamps.org";
const BOB = "https://bob.btc.calendar.opentimestamps.org";
const FINNEY = "https://finney.calendar.eternitywall.com";
const HOSTS = [ALICE, BOB, FINNEY, "https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org"];

/** A valid proof just under the 16 KiB cap (the last branch is sized to fill it). */
async function bigProof(id: Uint8Array) {
  const build = async (last: number) => {
    const file = newOtsFile(id);
    const root = await addOp(await addOp(file.timestamp, { kind: "append", arg: new Uint8Array(16).fill(9) }), { kind: "sha256" });
    for (let i = 0; i < 5; i++) {
      const leaf = await addOp(await addOp(root, { kind: "append", arg: new Uint8Array(i < 4 ? 3000 : last).fill(i) }), { kind: "sha256" });
      leaf.attestations.push({ kind: "pending", uri: HOSTS[i] });
    }
    return serializeOtsFile(file);
  };
  // two passes: the length prefix of the last argument grows with it
  let last = 200;
  let bytes = await build(last);
  for (let i = 0; i < 2; i++) bytes = await build((last += 16 * 1024 - 20 - bytes.length));
  expect(bytes.length).toBe(16 * 1024 - 20);
  return bytes;
}

const calendarsOf = async (ots: Uint8Array) => proofSummary(await parseOtsFile(ots, Infinity)).calendars.sort();

describe("REQ-PASTE-084 only the paste's author shares a proof with the room", () => {
  it("rejects a compact junk proof from a non-author and lets the author's proof spread through relays", async () => {
    const net = new PasteMockNet();
    const [rb, rc] = [net.room("b"), net.room("c")];
    const b = await board(rb);
    const c = await board(rc);
    net.link(rb, rc);
    const p = await itemFrame("victim");
    rb.inject("paste", p.frame, "authorPeer");
    await until(() => b.pastes().length === 1 && c.pastes().length === 0);
    rc.inject("paste", p.frame, "authorPeer");
    await until(() => c.pastes().length === 1);
    // 8 calendars under an allowed suffix and a Bitcoin attestation at the root: 476 bytes
    const junk = await pendingProof(p.id, Array.from({ length: 8 }, (_, i) => `https://x${i}.calendar.opentimestamps.org`));
    junk.timestamp.attestations.push({ kind: "bitcoin", height: 1 });
    const attacker = await createAuthor();
    rb.inject("paste", await proofFrame(attacker, p.id, serializeOtsFile(junk)), "attacker");
    await settle();
    expect(b.pastes()[0].proof).toBeUndefined();
    expect(b.strikes("attacker")).toBe(1);
    // the author's proof is adopted and relayed to c, which is not connected to the author
    rb.inject("paste", await proofFrame(p.author, p.id, serializeOtsFile(await pendingProof(p.id, [ALICE, FINNEY]))), "authorPeer");
    await until(() => !!c.pastes()[0].proof);
    expect(await calendarsOf(b.pastes()[0].proof!)).toEqual([ALICE, FINNEY]);
    expect(await calendarsOf(c.pastes()[0].proof!)).toEqual([ALICE, FINNEY]);
    expect(c.pastes()[0].proofSource).toBe("author");
    expect(c.strikes("b")).toBe(0);
  });

  it("rejects a forged Bitcoin attestation from a non-author, leaving the author's proof intact", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const p = await itemFrame("victim");
    room.inject("paste", p.frame, "authorPeer");
    await until(() => b.pastes().length === 1);
    const honest = serializeOtsFile(await pendingProof(p.id, [ALICE, FINNEY]));
    room.inject("paste", await proofFrame(p.author, p.id, honest), "authorPeer");
    await until(() => !!b.pastes()[0].proof);
    room.inject("paste", await proofFrame(await createAuthor(), p.id, await poison(honest)), "attacker");
    await settle();
    const summary = proofSummary(await parseOtsFile(b.pastes()[0].proof!));
    expect(summary.calendars.sort()).toEqual([ALICE, FINNEY]);
    expect(summary.heights).toEqual([]);
    expect(b.strikes("attacker")).toBe(1);
  });

  it("rejects an author-signed proof modified in transit", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const p = await itemFrame("victim");
    room.inject("paste", p.frame, "authorPeer");
    await until(() => b.pastes().length === 1);
    const honest = serializeOtsFile(await pendingProof(p.id, [ALICE]));
    room.inject("paste", await proofFrame(p.author, p.id, honest, await poison(honest)), "relay");
    // the signature also binds the paste id
    const other = await itemFrame("other");
    room.inject("paste", other.frame, "authorPeer");
    await until(() => b.pastes().length === 2);
    const forOther = serializeOtsFile(await pendingProof(other.id, [ALICE]));
    const sig = await signSharedProof(other.author.key.privateKey, (await roomKeys()).tag, other.id, forOther);
    room.inject("paste", await frame(FrameType.PROOF, encodeProof(p.id, sig, forOther)), "relay");
    await settle();
    expect(b.pastes().every((x) => !x.proof)).toBe(true);
    expect(b.strikes("relay")).toBe(2);
  });

  it("keeps the held author proof, without a strike, when a union would be too large", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const p = await itemFrame("p");
    room.inject("paste", p.frame, "authorPeer");
    await until(() => b.pastes().length === 1);
    room.inject("paste", await proofFrame(p.author, p.id, await bigProof(p.id)), "authorPeer");
    await until(() => !!b.pastes()[0].proof);
    const held = b.pastes()[0].proof!;
    room.inject("paste", await proofFrame(p.author, p.id, serializeOtsFile(await pendingProof(p.id, [ALICE], 2))), "relay");
    await settle();
    expect(b.pastes()[0].proof).toEqual(held);
    expect(b.strikes("relay")).toBe(0);
  });

  it("refuses author proofs naming calendars outside the allow-list, unknown attestations or too many attestations, without strikes", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const p = await itemFrame("p");
    room.inject("paste", p.frame, "x");
    await until(() => b.pastes().length === 1);
    const outside = await pendingProof(p.id, [ALICE, "https://x0.calendar.opentimestamps.org"]);
    const unknown = await pendingProof(p.id, [ALICE], 4);
    unknown.timestamp.attestations.push({ kind: "unknown", tag: new Uint8Array(8).fill(1), payload: Uint8Array.of(1) });
    const many = await pendingProof(p.id, new Array(33).fill(ALICE), 5);
    for (const f of [outside, unknown, many]) room.inject("paste", await proofFrame(p.author, p.id, serializeOtsFile(f)), "x");
    await settle();
    expect(b.pastes()[0].proof).toBeUndefined();
    expect(b.strikes("x")).toBe(0); // signed by the author: a relaying peer is not at fault
  });

  it("lets the author replace an oversized shared proof with a new stamp, and says so", async () => {
    const a = await board(new PasteMockNet().room("a"));
    clock += 3_000;
    const p = await a.post({ format: "text", source: "mine", attachments: [] });
    if ("error" in p) throw new Error(p.error);
    expect(await a.attachProof(p.id, await bigProof(p.id))).toBe("shared");
    expect(await a.attachProof(p.id, serializeOtsFile(await pendingProof(p.id, [ALICE], 3)))).toBe("replaced");
    expect(await calendarsOf(a.pastes()[0].proof!)).toEqual([ALICE]);
  });

  it("keeps a non-author's own stamp on its device, next to the author's shared proof", async () => {
    const net = new PasteMockNet();
    const [ra, rb] = [net.room("a"), net.room("b")];
    const a = await board(ra);
    const b = await board(rb);
    net.link(ra, rb);
    clock += 3_000;
    const p = await a.post({ format: "text", source: "by a", attachments: [] });
    if ("error" in p) throw new Error(p.error);
    await until(() => b.pastes().length === 1);
    await settle();
    const before = rb.sent.length;
    expect(await b.attachProof(p.id, serializeOtsFile(await pendingProof(p.id, [BOB], 7)))).toBe("local");
    await settle();
    expect(rb.sent.length).toBe(before); // never broadcast
    expect(a.pastes()[0].proof).toBeUndefined();
    expect(b.pastes()[0].proofSource).toBe("local");
    expect(await calendarsOf(b.pastes()[0].proof!)).toEqual([BOB]);
    expect(await a.attachProof(p.id, serializeOtsFile(await pendingProof(p.id, [ALICE], 8)))).toBe("shared");
    await until(() => b.pastes()[0].proofSource === "both");
    expect(await calendarsOf(b.pastes()[0].proof!)).toEqual([ALICE, BOB]); // this device's view: both
    expect(await calendarsOf(b.pastes()[0].sharedProof!.ots)).toEqual([ALICE]); // what is shared: the author's
  });
});

describe("REQ-PASTE-075 paste requests answered once within an outbound budget", () => {
  it("answers each held id once per request, not again within the retry window, within an outbound budget", async () => {
    const net = new PasteMockNet();
    const rb = net.room("b");
    const b = await board(rb, { postIntervalMs: 0, replyBytesBurst: 800, replyBytesPerSecond: 0 });
    const ids: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await b.post({ format: "text", source: `paste ${i} ${"x".repeat(200)}`, attachments: [] });
      if ("error" in p) throw new Error(p.error);
      ids.push(p.id);
    }
    const toX = () => rb.sent.filter((s) => s.to === "x").length;
    rb.inject("paste", await frame(FrameType.WANT, encodeIdList(new Array(2000).fill(ids[0]))), "x");
    await settle();
    expect(toX()).toBe(1);
    rb.inject("paste", await frame(FrameType.WANT, encodeIdList([ids[0]])), "x");
    await settle();
    expect(toX()).toBe(1); // recently sent
    rb.inject("paste", await frame(FrameType.WANT, encodeIdList(ids)), "x");
    await settle();
    expect(toX()).toBe(2); // the budget (800 bytes, about 340 per ITEM) allows one more ITEM only
  });
});

describe("REQ-PASTE-076 bounded paste requests", () => {
  it("requests at most the free capacity and expires requests without striking the peer", async () => {
    const net = new PasteMockNet();
    const [rb, rx] = [net.room("b"), net.room("x")];
    const b = await board(rb, { maxPastes: 10 });
    net.link(rb, rx);
    await settle();
    const fake = Array.from({ length: 1000 }, (_, i) => Uint8Array.from({ length: 32 }, (_, j) => (i * 7 + j) & 255));
    rb.inject("paste", await frame(FrameType.INV, encodeIdList(fake)), "x");
    await settle();
    const wants = rb.sent.filter((s) => s.to === "x" && s.size > 30);
    expect(wants.length).toBe(1);
    expect(wants[0].size).toBe(2 + 12 + 16 + 10 * 32);
    expect(b.stats().wanted).toBe(10);
    clock += 15_001;
    b.tick();
    await settle();
    expect(b.stats().wanted).toBe(0);
    expect(b.strikes("x")).toBe(0); // slow or busy peers are not punished
  });

  it("re-requests an id from another advertiser once the first request expired, without strikes", async () => {
    const net = new PasteMockNet();
    const [rb, rx, ry] = [net.room("b"), net.room("x"), net.room("y")];
    const b = await board(rb);
    net.link(rb, rx);
    net.link(rb, ry);
    await settle();
    const id = new Uint8Array(32).fill(0x5a);
    rb.inject("paste", await frame(FrameType.INV, encodeIdList([id])), "x");
    await settle();
    rb.inject("paste", await frame(FrameType.INV, encodeIdList([id])), "y");
    await settle();
    const wantsTo = (peer: string) => rb.sent.filter((s) => s.to === peer && s.size === 2 + 12 + 16 + 32).length;
    expect([wantsTo("x"), wantsTo("y")]).toEqual([1, 0]);
    clock += 15_001;
    b.tick();
    await settle();
    expect([wantsTo("x"), wantsTo("y")]).toEqual([1, 1]);
    expect(b.stats().wanted).toBe(1);
    clock += 15_001;
    b.tick();
    await settle();
    expect(b.stats().wanted).toBe(0); // no advertiser left to try
    expect([b.strikes("x"), b.strikes("y")]).toEqual([0, 0]);
  });

  it("shares the free places between advertising peers", async () => {
    const net = new PasteMockNet();
    const [rb, rx, ry] = [net.room("b"), net.room("x"), net.room("y")];
    const b = await board(rb, { maxPastes: 10 });
    net.link(rb, rx);
    net.link(rb, ry);
    await settle();
    const ids = (seed: number, n: number) => Array.from({ length: n }, (_, i) => Uint8Array.from({ length: 32 }, (_, j) => (seed + i * 7 + j * 13) & 255));
    rb.inject("paste", await frame(FrameType.INV, encodeIdList(ids(1, 1000))), "x");
    await settle();
    expect(b.stats().wanted).toBe(5);
    rb.inject("paste", await frame(FrameType.INV, encodeIdList(ids(101, 5))), "y");
    await settle();
    expect(b.stats().wanted).toBe(10);
    const want = (peer: string) => rb.sent.filter((s) => s.to === peer && s.size > 30).map((s) => (s.size - 30) / 32);
    expect(want("x")).toEqual([5]);
    expect(want("y")).toEqual([5]);
  });
});

describe("REQ-PASTE-072 attachment bytes counted on arrival", () => {
  it("counts attachment bytes when they arrive", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room, { maxAttachmentBytes: 100, postIntervalMs: 0 });
    for (let i = 0; i < 3; i++) {
      const att = { hash: await sha256(Uint8Array.of(i, 1)), size: 60, mime: "application/pdf", name: "a.pdf", width: 0, height: 0 };
      room.inject("paste", (await itemFrame(`declares ${i}`, [att])).frame, "liar");
    }
    await until(() => b.pastes().length === 3);
    expect(b.isFull()).toBe(false);
    const ok = await b.post({ format: "text", source: "real", attachments: [{ bytes: new Uint8Array(90), mime: "application/pdf", name: "r.pdf", width: 0, height: 0 }] });
    expect("id" in ok).toBe(true);
    // a declared attachment arriving beyond the budget is not stored
    const bytes = new Uint8Array(60).fill(5);
    const att = { hash: await sha256(bytes), size: 60, mime: "application/pdf", name: "b.pdf", width: 0, height: 0 };
    room.inject("paste", (await itemFrame("late", [att])).frame, "peer");
    await until(() => b.pastes().length === 5);
    room.inject("pblob", await frame(FrameType.BLOB, encodeBlob(att.hash, bytes)), "peer");
    await settle();
    expect(b.attachment(att.hash)).not.toBeInstanceOf(Uint8Array);
    expect(b.isFull()).toBe(true);
    expect(b.strikes("peer")).toBe(0);
  });
});

describe("REQ-PASTE-036 unsolicited attachment frames", () => {
  it("stores a listed missing attachment, ignores unlisted and duplicate ones without strikes", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const bytes = Uint8Array.of(1, 2, 3);
    const att = { hash: await sha256(bytes), size: 3, mime: "application/pdf", name: "a.pdf", width: 0, height: 0 };
    room.inject("paste", (await itemFrame("p", [att])).frame, "x");
    await until(() => b.pastes().length === 1);
    const other = Uint8Array.of(9);
    room.inject("pblob", await frame(FrameType.BLOB, encodeBlob(await sha256(other), other)), "y");
    room.inject("pblob", await frame(FrameType.BLOB, encodeBlob(att.hash, bytes)), "y");
    room.inject("pblob", await frame(FrameType.BLOB, encodeBlob(att.hash, bytes)), "y");
    await settle();
    expect(b.attachment(att.hash)).toEqual(bytes);
    expect(b.attachment(await sha256(other))).toBe("unavailable");
    expect(b.strikes("y")).toBe(0);
  });
});

describe("REQ-PASTE-051 / REQ-PASTE-075 late join and duplicate frames", () => {
  it("delivers a large board to a late joiner without waiting for budget refills", async () => {
    const net = new PasteMockNet();
    const [ra, rc] = [net.room("a"), net.room("c")];
    const a = await board(ra, { postIntervalMs: 0, maxPastesPerAuthor: 1000 });
    const c = await board(rc, { maxPastesPerAuthor: 1000 });
    for (let i = 0; i < 300; i++) {
      const r = await a.post({ format: "text", source: `n${i}`, attachments: [] });
      if ("error" in r) throw new Error(r.error);
    }
    net.link(ra, rc);
    await until(() => c.pastes().length === 300, 10_000);
    expect(c.stats().budgetDrops).toBe(0);
  });

  it("drops a frame received twice (e.g. through two strategies) before charging the budget", async () => {
    const room = new PasteMockNet().room("b");
    const b = await board(room);
    const f = await frame(FrameType.INV, new Uint8Array(0));
    room.inject("paste", f, "x");
    room.inject("paste", f.slice(0), "x");
    await settle();
    expect(b.stats().duplicateDrops).toBe(1);
  });
});

describe("REQ-PASTE-074 post rate limit", () => {
  it("refuses a second post started before the first one finished", async () => {
    const b = await board(new PasteMockNet().room("b"));
    clock += 3_000;
    const [one, two] = await Promise.all([
      b.post({ format: "text", source: "1", attachments: [] }),
      b.post({ format: "text", source: "2", attachments: [] }),
    ]);
    expect(["id" in one, "error" in two && two.error]).toEqual([true, "rate"]);
  });

  it("does not consume the cool-down when a post is refused", async () => {
    const b = await board(new PasteMockNet().room("b"));
    clock += 3_000;
    expect(await b.post({ format: "text", source: "x".repeat(20_000), attachments: [] })).toEqual({ error: "too-large" });
    expect("id" in (await b.post({ format: "text", source: "ok", attachments: [] }))).toBe(true);
  });
});
