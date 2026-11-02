import { describe, expect, it } from "bun:test";
import { AudioReceiveSession, AudioSendSession, type ReceiveComplete, type ReceiveEvent } from "@/audio/session";
import { decodeOnAir, encodeSealedMetadataBody, maxFilenameBytes, parseAudioPacket } from "@/audio/packet";
import { PAD_BUCKET, deriveSealKey, openPayload, sealPayload, openMetadata, sealMetadata } from "@/audio/sealed";
import { getProfile } from "@/audio/profiles";
import { randomBytes, silence } from "./helpers";

const fast = getProfile("fast");
const robust = getProfile("robust");
const PASSWORD = "correct horse";
const text = (s: string) => new TextEncoder().encode(s);
const SECRET = text("Wi-Fi: QRShare-Guest / password: tr0ub4dor&3");

function completeOf(events: ReceiveEvent[]): ReceiveComplete {
  const c = events.find((e): e is ReceiveComplete => e.kind === "complete");
  if (!c) throw new Error("transfer did not complete");
  return c;
}

async function feed(rx: AudioReceiveSession, tx: AudioSendSession, n: number, events: ReceiveEvent[] = []) {
  for (let i = 0; i < n && !events.some((e) => e.kind === "complete"); i++) {
    events.push(...(await rx.ingest(decodeOnAir(tx.nextPacket().bytes), tx.profile.id)));
  }
  return events;
}

const includes = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

describe("sealed primitives", () => {
  it("pads the payload to a multiple of PAD_BUCKET and opens it back", async () => {
    const key = await deriveSealKey(PASSWORD, new Uint8Array(16).fill(1));
    for (const n of [0, 1, 200, 251, 252, 600]) {
      const data = randomBytes(n, n + 1);
      const sealed = await sealPayload(data, key);
      expect((sealed.length - 12 - 16) % PAD_BUCKET).toBe(0);
      expect(await openPayload(sealed, key)).toEqual(data);
    }
  });

  it("authenticates the metadata with the session id and salt", async () => {
    const salt = new Uint8Array(16).fill(2);
    const key = await deriveSealKey(PASSWORD, salt);
    const sid = new Uint8Array([1, 2, 3, 4]);
    const { iv, ciphertext } = await sealMetadata(text("frame"), key, sid, salt);
    expect(await openMetadata(ciphertext, iv, key, sid, salt)).toEqual(text("frame"));
    expect(await openMetadata(ciphertext, iv, key, new Uint8Array([9, 9, 9, 9]), salt)).toBeNull();
    const wrong = await deriveSealKey("nope", salt);
    expect(await openMetadata(ciphertext, iv, wrong, sid, salt)).toBeNull();
  });
});

describe("sealed audio transfer: nothing readable without the password (REQ-AUD-022, REQ-AUD-023)", () => {
  it("hides the file name, the size and the content type from the air", async () => {
    const name = text("bank-codes.txt");
    const tx = await AudioSendSession.create(SECRET, "bank-codes.txt", { isText: true, profile: fast, password: PASSWORD });
    expect(tx.info.sealed).toBe(true);
    for (let i = 0; i < 20; i++) {
      const pkt = tx.nextPacket();
      expect(includes(pkt.bytes, name)).toBe(false);
      expect(includes(pkt.bytes, SECRET.subarray(0, 12))).toBe(false);
      const parsed = decodeOnAir(pkt.bytes);
      if (parsed.kind !== "ok") throw new Error("packet should decode");
      expect(parsed.packet.kind === "metadata").toBe(false); // only sealed metadata on the air
    }
    tx.free();
  });

  it("gives the same on-air size to payloads in the same 256-byte bucket", async () => {
    const a = await AudioSendSession.create(text("hi"), "a.txt", { isText: true, profile: fast, password: PASSWORD });
    const b = await AudioSendSession.create(randomBytes(200, 3), "b.bin", { isText: false, profile: fast, password: PASSWORD });
    expect(a.info.k).toBe(b.info.k);
    expect(a.info.compressedSize).toBe(b.info.compressedSize);
    a.free();
    b.free();
  });

  it("uses a random session id, unlinkable to the content", async () => {
    const a = await AudioSendSession.create(SECRET, "m.txt", { isText: true, profile: fast, password: PASSWORD });
    const b = await AudioSendSession.create(SECRET, "m.txt", { isText: true, profile: fast, password: PASSWORD });
    expect(a.info.sessionId).not.toBe(b.info.sessionId);
    a.free();
    b.free();
  });

  it("keeps the sealed metadata within one packet for every profile", () => {
    expect(maxFilenameBytes(robust, true)).toBe(255 - 16 - 110);
    expect(maxFilenameBytes(fast, true)).toBe(255 - 12 - 110);
    const body = encodeSealedMetadataBody(new Uint8Array(4), new Uint8Array(16), new Uint8Array(12), new Uint8Array(57 + 16));
    expect(parseAudioPacket(body).kind).toBe("ok");
  });
});

describe("sealed audio transfer: receiver (REQ-AUD-024, REQ-AUD-025)", () => {
  it("decrypts automatically with a password given before listening", async () => {
    const tx = await AudioSendSession.create(SECRET, "notes.txt", { isText: true, profile: fast, password: PASSWORD });
    const rx = new AudioReceiveSession(48000, { password: PASSWORD });
    const done = completeOf(await feed(rx, tx, 200));
    expect(done.file).toEqual(SECRET);
    expect(done.filename).toBe("notes.txt");
    expect(done.isText).toBe(true);
    expect(done.verified).toBe(true);
    expect(done.sealed).toBe(true);
    tx.free();
    rx.free();
  });

  it("asks for the password when it detects a sealed transfer, keeps listening, then completes", async () => {
    const data = randomBytes(700, 9);
    const tx = await AudioSendSession.create(data, "key.bin", { isText: false, profile: fast, password: PASSWORD });
    const rx = new AudioReceiveSession(48000);
    const events = await feed(rx, tx, 25);
    expect(events.filter((e) => e.kind === "password_required").length).toBe(1);
    expect(events.some((e) => e.kind === "complete")).toBe(false);
    const after = await rx.setPassword(PASSWORD);
    const all = [...events, ...after];
    if (!all.some((e) => e.kind === "complete")) await feed(rx, tx, 200, all);
    expect(completeOf(all).file).toEqual(data);
    tx.free();
    rx.free();
  });

  it("reports a wrong password at once and accepts the right one afterwards", async () => {
    const tx = await AudioSendSession.create(SECRET, "m.txt", { isText: true, profile: fast, password: PASSWORD });
    const rx = new AudioReceiveSession(48000, { password: "wrong" });
    const events = await feed(rx, tx, 3);
    const err = events.find((e) => e.kind === "error");
    expect(err?.kind === "error" && err.code).toBe("wrong_password");
    expect(rx.isDone).toBe(false);
    const after = await rx.setPassword(PASSWORD);
    const all = [...events, ...after];
    await feed(rx, tx, 200, all);
    expect(completeOf(all).file).toEqual(SECRET);
    tx.free();
    rx.free();
  });

  it("follows the sender re-prepared with a new salt (same content, same password)", async () => {
    const data = randomBytes(900, 10);
    const before = await AudioSendSession.create(data, "f.bin", { isText: false, profile: robust, password: PASSWORD });
    const after = await AudioSendSession.create(data, "f.bin", { isText: false, profile: fast, password: PASSWORD });
    const rx = new AudioReceiveSession(48000, { password: PASSWORD });
    const events = await feed(rx, before, 5);
    await feed(rx, after, 300, events);
    expect(completeOf(events).file).toEqual(data);
    before.free();
    after.free();
    rx.free();
  });

  it("works through the modem with packet loss", async () => {
    const tx = await AudioSendSession.create(SECRET, "message.txt", { isText: true, profile: fast, password: PASSWORD });
    const rx = new AudioReceiveSession(48000, { password: PASSWORD });
    const events: ReceiveEvent[] = [];
    for (let i = 0; i < 120 && !events.some((e) => e.kind === "complete"); i++) {
      const x = tx.nextSamples(48000);
      events.push(...(await rx.push(i % 4 === 1 ? new Float32Array(x.length) : x)));
    }
    events.push(...(await rx.push(silence(1, 48000))));
    expect(completeOf(events).file).toEqual(SECRET);
    tx.free();
    rx.free();
  });

  it("still receives unencrypted transfers unchanged", async () => {
    const tx = await AudioSendSession.create(SECRET, "plain.txt", { isText: true, profile: fast });
    expect(tx.info.sealed).toBe(false);
    const rx = new AudioReceiveSession(48000, { password: PASSWORD });
    const done = completeOf(await feed(rx, tx, 100));
    expect(done.file).toEqual(SECRET);
    expect(done.sealed).toBe(false);
    tx.free();
    rx.free();
  });
});
