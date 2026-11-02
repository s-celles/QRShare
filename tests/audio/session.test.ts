import { describe, expect, it } from "bun:test";
import {
  AudioSendSession,
  AudioReceiveSession,
  AudioPayloadTooLargeError,
  onAirSymbolId,
  type ReceiveEvent,
  type ReceiveComplete,
} from "@/audio/session";
import { decodeOnAir, encodeDataBody, encodeMetadataBody, encodeOnAir } from "@/audio/packet";
import { AUDIO_MAX_BYTES, META_INTERVAL, getProfile } from "@/audio/profiles";
import { LTCodecFactory } from "@/codec/lt-adapter";
import type { FountainCodecFactory } from "@/codec/types";
import { decodeFlags, encodeFlags } from "@/protocol/frame";
import { awgn, concat, prng, randomBytes, silence } from "./helpers";

const robust = getProfile("robust");
const fast = getProfile("fast");
const text = (s: string) => new TextEncoder().encode(s);
const LOREM = "Wi-Fi: QRShare-Guest / password: correct horse battery staple. ".repeat(8);
/** Text that barely compresses (random letters), so K is realistic. */
const randomText = (n: number, seed: number) =>
  Array.from(randomBytes(n, seed), (b) => (b % 7 === 0 ? " " : String.fromCharCode(97 + (b % 26)))).join("");

async function feedBytes(rx: AudioReceiveSession, tx: AudioSendSession, packets: number, keep: (i: number) => boolean = () => true) {
  const events: ReceiveEvent[] = [];
  for (let i = 0; i < packets; i++) {
    const pkt = tx.nextPacket();
    if (!keep(i)) continue;
    events.push(...(await rx.ingest(decodeOnAir(pkt.bytes), tx.profile.id)));
    if (events.some((e) => e.kind === "complete")) break;
  }
  return events;
}

function completeOf(events: ReceiveEvent[]): ReceiveComplete {
  const c = events.find((e): e is ReceiveComplete => e.kind === "complete");
  if (!c) throw new Error("transfer did not complete");
  return c;
}

describe("AudioSendSession.create (REQ-AUD-012, 075, 077)", () => {
  it("hashes, compresses and picks the profile block size", async () => {
    const data = text(randomText(800, 12));
    const tx = await AudioSendSession.create(data, "message.txt", { isText: true, profile: robust });
    expect(tx.info.fileSize).toBe(data.length);
    expect(tx.info.compressedSize).toBeLessThan(data.length);
    expect(tx.info.blockSize).toBe(robust.blockSize);
    expect(tx.info.k).toBe(Math.ceil(tx.info.compressedSize / robust.blockSize));
    expect(tx.info.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.info.estimatedMinSec).toBeGreaterThan(0);
    tx.free();
  });

  it("prefers Wirehair in auto mode and honours forced LT", async () => {
    const data = randomBytes(500, 1);
    const auto = await AudioSendSession.create(data, "a.bin", { isText: false, profile: robust });
    expect(auto.info.codec).toBe("wirehair");
    const lt = await AudioSendSession.create(data, "a.bin", { isText: false, profile: robust, codec: "lt" });
    expect(lt.info.codec).toBe("lt");
    const meta = decodeOnAir(lt.nextPacket().bytes);
    if (meta.kind !== "ok" || meta.packet.kind !== "metadata") throw new Error("expected metadata first");
    expect(decodeFlags(meta.packet.frame.flags).codec).toBe("lt");
    auto.free();
    lt.free();
  });

  it("falls back to LT when the auto factory is not Wirehair", async () => {
    const tx = await AudioSendSession.create(randomBytes(300, 2), "b.bin", {
      isText: false,
      profile: robust,
      autoFactory: async () => new LTCodecFactory(),
    });
    expect(tx.info.codec).toBe("lt");
    tx.free();
  });

  it("shrinks the block size so that K >= 2", async () => {
    const tx = await AudioSendSession.create(randomBytes(60, 3), "c.bin", { isText: false, profile: robust });
    expect(tx.info.k).toBeGreaterThanOrEqual(2);
    expect(tx.info.blockSize).toBe(30);
    tx.free();
  });

  it("refuses payloads above the hard limit and empty payloads (REQ-AUD-011)", async () => {
    await expect(AudioSendSession.create(new Uint8Array(AUDIO_MAX_BYTES + 1), "big", { isText: false, profile: robust }))
      .rejects.toBeInstanceOf(AudioPayloadTooLargeError);
    await expect(AudioSendSession.create(new Uint8Array(0), "empty", { isText: false, profile: robust })).rejects.toThrow();
  });

  it("accepts exactly the hard limit", async () => {
    const tx = await AudioSendSession.create(randomBytes(AUDIO_MAX_BYTES, 4), "max.bin", { isText: false, profile: fast });
    expect(tx.info.fileSize).toBe(AUDIO_MAX_BYTES);
    tx.free();
  });
});

describe("packet sequence (REQ-AUD-015, 016)", () => {
  it("sends M, D×8, M, … with increasing symbolIds", async () => {
    const tx = await AudioSendSession.create(randomBytes(800, 5), "d.bin", { isText: false, profile: fast });
    const kinds: string[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 2 * (META_INTERVAL + 1) + 1; i++) {
      const p = tx.nextPacket();
      kinds.push(p.kind);
      ids.push(p.symbolId);
      const parsed = decodeOnAir(p.bytes);
      expect(parsed.kind).toBe("ok");
    }
    expect(kinds[0]).toBe("metadata");
    expect(kinds.slice(1, 9).every((k) => k === "data")).toBe(true);
    expect(kinds[9]).toBe("metadata");
    expect(kinds[18]).toBe("metadata");
    expect(ids.filter((_, i) => kinds[i] === "data")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(tx.packetsSent).toBe(19);
    expect(tx.uniqueSymbolsSent).toBe(16);
    tx.free();
  });

  it("wraps on-air symbolIds from 65535 to 1", () => {
    expect(onAirSymbolId(0)).toBe(1);
    expect(onAirSymbolId(65533)).toBe(65534);
    expect(onAirSymbolId(65534)).toBe(65535);
    expect(onAirSymbolId(65535)).toBe(1);
    expect(onAirSymbolId(65536)).toBe(2);
  });

  it("continues past the wrap in a running session", async () => {
    const tx = await AudioSendSession.create(randomBytes(200, 6), "e.bin", { isText: false, profile: fast, startIndex: 65533 });
    const ids: number[] = [];
    while (ids.length < 4) {
      const p = tx.nextPacket();
      if (p.kind === "data") ids.push(p.symbolId);
    }
    expect(ids).toEqual([65534, 65535, 1, 2]);
    expect(tx.uniqueSymbolsSent).toBe(65535);
    tx.free();
  });
});

describe("AudioReceiveSession (REQ-AUD-036, 037, 038, 039)", () => {
  it("completes, verifies and flags text", async () => {
    const data = text(LOREM);
    const tx = await AudioSendSession.create(data, "message.txt", { isText: true, profile: robust });
    const rx = new AudioReceiveSession(48000);
    const events = await feedBytes(rx, tx, 200);
    const done = completeOf(events);
    expect(done.file).toEqual(data);
    expect(done.verified).toBe(true);
    expect(done.isText).toBe(true);
    expect(done.filename).toBe("message.txt");
    expect(done.sha256Hex).toBe(tx.info.sha256Hex);
    const progress = events.filter((e) => e.kind === "progress");
    expect(progress.length).toBeGreaterThan(0);
    tx.free();
    rx.free();
  });

  it("buffers data packets heard before the metadata and replays them", async () => {
    const data = randomBytes(1500, 7);
    const tx = await AudioSendSession.create(data, "late.bin", { isText: false, profile: fast, codec: "lt" });
    const rx = new AudioReceiveSession(48000);
    // Drop the first metadata packet: data arrives first and must be buffered.
    const events = await feedBytes(rx, tx, 400, (i) => i !== 0);
    const firstProgress = events.find((e) => e.kind === "progress");
    if (firstProgress?.kind !== "progress") throw new Error();
    expect(firstProgress.needed).toBe(0); // metadata not yet known
    expect(firstProgress.received).toBe(1);
    const done = completeOf(events);
    expect(done.file).toEqual(data);
    expect(done.isText).toBe(false);
    tx.free();
    rx.free();
  });

  it("drops duplicate symbolIds", async () => {
    const tx = await AudioSendSession.create(randomBytes(900, 8), "dup.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const meta = decodeOnAir(tx.nextPacket().bytes);
    const d1 = decodeOnAir(tx.nextPacket().bytes);
    await rx.ingest(meta, "fast");
    const a = await rx.ingest(d1, "fast");
    const b = await rx.ingest(d1, "fast");
    const pa = a.find((e) => e.kind === "progress");
    const pb = b.find((e) => e.kind === "progress");
    if (pa?.kind !== "progress" || pb?.kind !== "progress") throw new Error();
    expect(pa.received).toBe(1);
    expect(pb.received).toBe(1);
    expect(pb.duplicates).toBe(1);
    tx.free();
    rx.free();
  });

  it("locks to the first session heard and ignores others", async () => {
    const a = await AudioSendSession.create(text("first sender ".repeat(30)), "a.txt", { isText: true, profile: fast });
    const b = await AudioSendSession.create(text("second sender ".repeat(30)), "b.txt", { isText: true, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    for (let i = 0; i < 200 && !events.some((e) => e.kind === "complete"); i++) {
      events.push(...(await rx.ingest(decodeOnAir(a.nextPacket().bytes), "fast")));
      events.push(...(await rx.ingest(decodeOnAir(b.nextPacket().bytes), "fast")));
    }
    const done = completeOf(events);
    expect(new TextDecoder().decode(done.file)).toBe("first sender ".repeat(30));
    expect(done.filename).toBe("a.txt");
    a.free();
    b.free();
    rx.free();
  });

  it("counts rejected packets", async () => {
    const rx = new AudioReceiveSession(48000);
    const ev = await rx.ingest({ kind: "rejected", reason: "crc" }, "robust");
    const p = ev.find((e) => e.kind === "progress");
    if (p?.kind !== "progress") throw new Error();
    expect(p.rejected).toBe(1);
    expect(p.accepted).toBe(0);
    rx.free();
  });

  it("reports verified: false when the metadata hash does not match", async () => {
    const data = randomBytes(400, 9);
    const tx = await AudioSendSession.create(data, "t.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const realMeta = decodeOnAir(tx.nextPacket().bytes);
    if (realMeta.kind !== "ok" || realMeta.packet.kind !== "metadata") throw new Error();
    const tampered = encodeMetadataBody({ ...realMeta.packet.frame, sha256: new Uint8Array(32).fill(0xee) }, fast);
    const events = await rx.ingest(decodeOnAir(encodeOnAir(tampered, fast)), "fast");
    for (let i = 0; i < 100 && !events.some((e) => e.kind === "complete"); i++) {
      const pkt = tx.nextPacket();
      if (pkt.kind === "data") events.push(...(await rx.ingest(decodeOnAir(pkt.bytes), "fast")));
    }
    const done = completeOf(events);
    expect(done.file).toEqual(data);
    expect(done.verified).toBe(false);
    tx.free();
    rx.free();
  });
});

describe("Wirehair unavailable (REQ-AUD-076)", () => {
  it("emits a wirehair_unavailable error when the decoder cannot start", async () => {
    const tx = await AudioSendSession.create(randomBytes(400, 10), "w.bin", { isText: false, profile: fast });
    expect(tx.info.codec).toBe("wirehair");
    const broken: FountainCodecFactory = {
      createEncoder: () => Promise.reject(new Error("no wasm")),
      createDecoder: () => Promise.reject(new Error("no wasm")),
      isWasmAvailable: () => false,
    };
    const rx = new AudioReceiveSession(48000, { wirehairFactory: broken });
    const events = await rx.ingest(decodeOnAir(tx.nextPacket().bytes), "fast");
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeDefined();
    if (err?.kind === "error") expect(err.code).toBe("wirehair_unavailable");
    tx.free();
    rx.free();
  });

  it("an LT sender still works with the same broken Wirehair receiver", async () => {
    const data = randomBytes(400, 11);
    const tx = await AudioSendSession.create(data, "w.bin", { isText: false, profile: fast, codec: "lt" });
    const rx = new AudioReceiveSession(48000, {
      wirehairFactory: { createEncoder: () => Promise.reject(new Error("x")), createDecoder: () => Promise.reject(new Error("x")), isWasmAvailable: () => false },
    });
    const done = completeOf(await feedBytes(rx, tx, 300));
    expect(done.file).toEqual(data);
    expect(decodeFlags(encodeFlags({ isText: false, codec: "lt" })).codec).toBe("lt");
    tx.free();
    rx.free();
  });
});

/** Plays a sender through the modem, dropping whole packets (replaced by silence). */
async function audioLoopback(
  tx: AudioSendSession,
  rx: AudioReceiveSession,
  sampleRate: number,
  opts: { dropRate?: number; seed?: number; maxPackets?: number; skipFirst?: number; transform?: (x: Float32Array) => Float32Array } = {},
): Promise<{ events: ReceiveEvent[]; packets: number; seconds: number }> {
  const r = prng(opts.seed ?? 1);
  const events: ReceiveEvent[] = [];
  let packets = 0;
  let samples = 0;
  for (let i = 0; i < (opts.maxPackets ?? 400); i++) {
    let x = tx.nextSamples(sampleRate);
    packets++;
    if (i < (opts.skipFirst ?? 0)) continue;
    if (r() < (opts.dropRate ?? 0)) x = new Float32Array(x.length);
    if (opts.transform) x = opts.transform(x);
    samples += x.length;
    events.push(...(await rx.push(x)));
    if (events.some((e) => e.kind === "complete")) break;
  }
  if (!events.some((e) => e.kind === "complete")) {
    events.push(...(await rx.push(silence(1, sampleRate))));
  }
  return { events, packets, seconds: samples / sampleRate };
}

describe("end-to-end audio loopback (REQ-AUD-113)", () => {
  for (const codec of ["auto", "lt"] as const) {
    it(`text over Robust with 30% packet loss (${codec})`, async () => {
      const data = text("Meet at 10:30, gate B. Key: 7f3a-91c2-e4d0-55aa. " + randomText(450, 13));
      const tx = await AudioSendSession.create(data, "message.txt", { isText: true, profile: robust, codec });
      const rx = new AudioReceiveSession(48000);
      const { events, packets, seconds } = await audioLoopback(tx, rx, 48000, { dropRate: 0.3, seed: 21 });
      const done = completeOf(events);
      expect(done.file).toEqual(data);
      expect(done.verified).toBe(true);
      expect(done.isText).toBe(true);
      console.log(`[measure] robust ${codec} (${tx.info.codec}): ${data.length} B (→${tx.info.compressedSize} B, K=${tx.info.k}) in ${packets} packets, ${seconds.toFixed(1)} s of audio with 30% loss`);
      tx.free();
      rx.free();
    });

    it(`binary over Fast with 30% packet loss (${codec})`, async () => {
      const data = randomBytes(700, 31);
      const tx = await AudioSendSession.create(data, "key.bin", { isText: false, profile: fast, codec });
      const rx = new AudioReceiveSession(44100);
      const { events, packets, seconds } = await audioLoopback(tx, rx, 44100, { dropRate: 0.3, seed: 22 });
      const done = completeOf(events);
      expect(done.file).toEqual(data);
      expect(done.verified).toBe(true);
      expect(done.isText).toBe(false);
      expect(done.filename).toBe("key.bin");
      console.log(`[measure] fast ${codec} (${tx.info.codec}): ${data.length} B binary (K=${tx.info.k}) in ${packets} packets, ${seconds.toFixed(1)} s of audio with 30% loss → ${(data.length / seconds).toFixed(1)} B/s`);
      tx.free();
      rx.free();
    });
  }

  it("receiver started mid-stream (metadata buffered)", async () => {
    const data = randomBytes(500, 41);
    const tx = await AudioSendSession.create(data, "mid.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const { events } = await audioLoopback(tx, rx, 48000, { skipFirst: 3 });
    expect(completeOf(events).file).toEqual(data);
    tx.free();
    rx.free();
  });

  it("two interleaved senders: locks to the first", async () => {
    const a = await AudioSendSession.create(text("alpha ".repeat(40)), "alpha.txt", { isText: true, profile: fast });
    const b = await AudioSendSession.create(text("bravo ".repeat(40)), "bravo.txt", { isText: true, profile: robust });
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    for (let i = 0; i < 100 && !events.some((e) => e.kind === "complete"); i++) {
      events.push(...(await rx.push(a.nextSamples(48000))));
      events.push(...(await rx.push(b.nextSamples(48000))));
    }
    events.push(...(await rx.push(silence(1, 48000))));
    expect(completeOf(events).filename).toBe("alpha.txt");
    a.free();
    b.free();
    rx.free();
  });

  it("Fast profile with in-band noise (12 dB)", async () => {
    const data = text("noisy room test ".repeat(20));
    const tx = await AudioSendSession.create(data, "message.txt", { isText: true, profile: fast });
    const rx = new AudioReceiveSession(48000);
    let seed = 300;
    const { events } = await audioLoopback(tx, rx, 48000, {
      transform: (x) => awgn(x, 12, [1500, 6300], 48000, seed++),
    });
    expect(completeOf(events).file).toEqual(data);
    tx.free();
    rx.free();
  });

  it("emits sync, level and progress events from push()", async () => {
    const tx = await AudioSendSession.create(text("hello audio"), "message.txt", { isText: true, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const events = await rx.push(concat(tx.nextSamples(48000), tx.nextSamples(48000), silence(0.5, 48000)));
    expect(events.some((e) => e.kind === "level")).toBe(true);
    expect(events.some((e) => e.kind === "sync")).toBe(true);
    const progress = events.filter((e) => e.kind === "progress");
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    if (last.kind === "progress") {
      expect(last.profile).toBe("fast");
      expect(last.filename).toBe("message.txt");
    }
    tx.free();
    rx.free();
  });
});


describe("sender re-prepared mid-transfer (review item 1)", () => {
  const data = randomBytes(900, 77);

  async function feedPackets(rx: AudioReceiveSession, tx: AudioSendSession, n: number, events: ReceiveEvent[]) {
    for (let i = 0; i < n && !events.some((e) => e.kind === "complete" || e.kind === "error"); i++) {
      events.push(...(await rx.ingest(decodeOnAir(tx.nextPacket().bytes), tx.profile.id)));
    }
  }

  it("uses a session id that depends on the transfer parameters", async () => {
    const a = await AudioSendSession.create(data, "f.bin", { isText: false, profile: robust });
    const b = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const c = await AudioSendSession.create(data, "f.bin", { isText: false, profile: robust, codec: "lt" });
    const a2 = await AudioSendSession.create(data, "f.bin", { isText: false, profile: robust });
    expect(a.info.sessionId).not.toBe(b.info.sessionId);
    expect(a.info.sessionId).not.toBe(c.info.sessionId);
    expect(a.info.sessionId).toBe(a2.info.sessionId);
    for (const s of [a, b, c, a2]) s.free();
  });

  it("switches to the new session when the profile changes (Robust → Fast)", async () => {
    const before = await AudioSendSession.create(data, "f.bin", { isText: false, profile: robust });
    const after = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    await feedPackets(rx, before, 6, events); // M + 5 data, not enough (K = 19)
    expect(events.some((e) => e.kind === "complete")).toBe(false);
    await feedPackets(rx, after, 200, events);
    const done = completeOf(events);
    expect(done.file).toEqual(data);
    expect(done.verified).toBe(true);
    before.free();
    after.free();
    rx.free();
  });

  it("switches to the new session when the codec changes (Wirehair → LT)", async () => {
    const before = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const after = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast, codec: "lt" });
    expect(before.info.codec).toBe("wirehair");
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    await feedPackets(rx, before, 6, events);
    // The new sender's first metadata packet is lost: its data must not reach the old decoder.
    after.nextPacket();
    await feedPackets(rx, after, 300, events);
    expect(events.some((e) => e.kind === "error")).toBe(false);
    const done = completeOf(events);
    expect(done.file).toEqual(data);
    before.free();
    after.free();
    rx.free();
  });

  it("restarting with the same parameters keeps decoding (identical symbols)", async () => {
    const before = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const again = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    await feedPackets(rx, before, 8, events);
    await feedPackets(rx, again, 200, events);
    expect(completeOf(events).file).toEqual(data);
    before.free();
    again.free();
    rx.free();
  });

  it("still ignores metadata of different content", async () => {
    const a = await AudioSendSession.create(data, "a.bin", { isText: false, profile: fast });
    const other = await AudioSendSession.create(randomBytes(900, 78), "b.bin", { isText: false, profile: robust });
    const rx = new AudioReceiveSession(48000);
    const events: ReceiveEvent[] = [];
    await feedPackets(rx, a, 3, events);
    await feedPackets(rx, other, 30, events);
    expect(events.some((e) => e.kind === "complete")).toBe(false);
    await feedPackets(rx, a, 200, events);
    expect(completeOf(events).filename).toBe("a.bin");
    a.free();
    other.free();
    rx.free();
  });

  it("does not mark a symbolId as seen when its length is wrong", async () => {
    const tx = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const meta = decodeOnAir(tx.nextPacket().bytes);
    await rx.ingest(meta, "fast");
    if (meta.kind !== "ok" || meta.packet.kind !== "metadata") throw new Error();
    const hash = meta.packet.frame.metadataHash;
    const good = decodeOnAir(tx.nextPacket().bytes);
    if (good.kind !== "ok" || good.packet.kind !== "data") throw new Error();
    const bad = decodeOnAir(encodeOnAir(encodeDataBody(hash, good.packet.symbolId, new Uint8Array(10)), fast));
    const e1 = await rx.ingest(bad, "fast");
    const e2 = await rx.ingest(good, "fast");
    const p1 = e1.find((e) => e.kind === "progress");
    const p2 = e2.find((e) => e.kind === "progress");
    if (p1?.kind !== "progress" || p2?.kind !== "progress") throw new Error();
    expect(p1.received).toBe(0);
    expect(p2.received).toBe(1);
    expect(p2.duplicates).toBe(0);
    tx.free();
    rx.free();
  });
});

describe("buffered symbols of the wrong size (review item 1)", () => {
  it("are dropped from the seen set when the metadata arrives", async () => {
    const tx = await AudioSendSession.create(randomBytes(900, 79), "f.bin", { isText: false, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const meta = decodeOnAir(tx.nextPacket().bytes);
    const good = decodeOnAir(tx.nextPacket().bytes);
    if (meta.kind !== "ok" || meta.packet.kind !== "metadata" || good.kind !== "ok" || good.packet.kind !== "data") throw new Error();
    const bad = decodeOnAir(encodeOnAir(encodeDataBody(meta.packet.frame.metadataHash, good.packet.symbolId, new Uint8Array(10)), fast));
    await rx.ingest(bad, "fast"); // buffered before metadata
    await rx.ingest(meta, "fast");
    const ev = await rx.ingest(good, "fast");
    const p = ev.find((e) => e.kind === "progress");
    if (p?.kind !== "progress") throw new Error();
    expect(p.received).toBe(1);
    expect(p.duplicates).toBe(0);
    tx.free();
    rx.free();
  });
});

describe("tiny payload estimate (review item 10)", () => {
  it("a 1-byte payload is not estimated slower than a 2-byte one", async () => {
    const one = await AudioSendSession.create(new Uint8Array([7]), "a", { isText: false, profile: robust });
    const two = await AudioSendSession.create(new Uint8Array([7, 9]), "a", { isText: false, profile: robust });
    expect(one.info.k).toBe(1);
    expect(one.info.codec).toBe("lt");
    expect(one.info.estimatedMinSec).toBeLessThanOrEqual(two.info.estimatedMinSec);
    one.free();
    two.free();
  });
});

describe("password-encrypted audio payload (review item 6)", () => {
  it("arrives encrypted, keeps the text flag, and unlocks with the password", async () => {
    const { encryptPayload, decryptPayload, isEncryptedPayload } = await import("@/crypto/encryption");
    const plain = text("Wi-Fi password: correct horse battery staple");
    const sealed = await encryptPayload(plain, "s3cret");
    const tx = await AudioSendSession.create(sealed, "message.txt", { isText: true, profile: fast });
    const rx = new AudioReceiveSession(48000);
    const { events } = await audioLoopback(tx, rx, 48000, { dropRate: 0.2, seed: 5 });
    const done = completeOf(events);
    expect(done.verified).toBe(true);
    expect(done.isText).toBe(true);
    expect(isEncryptedPayload(done.file)).toBe(true);
    expect(await decryptPayload(done.file, "s3cret")).toEqual(plain);
    tx.free();
    rx.free();
  });
});
