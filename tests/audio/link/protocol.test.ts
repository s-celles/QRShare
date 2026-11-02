import { describe, expect, it } from "bun:test";
import { encodeLinkBody, decodeOnAir, encodeOnAir, parseAudioPacket, maxLinkPayload } from "@/audio/packet";
import {
  LinkKind,
  encodeBeacon, decodeBeacon,
  encodeJoin, decodeJoin,
  encodeWelcome, decodeWelcome,
  encodeMembers, decodeMembers,
  encodeChat, decodeChat,
  encodePresence, decodePresence,
  encodeRseqOnly, decodeRseqOnly,
  encodeFileDone, decodeFileDone,
  MAX_CHAT_BYTES,
} from "@/audio/link/protocol";
import { AUDIO_PROFILES, getProfile } from "@/audio/profiles";

const fp = (n: number) => new Uint8Array(8).fill(n);

describe("link packets (REQ-ALS-007, 010)", () => {
  it("round-trips the clear header through the RS/CRC packet layer", () => {
    const body = encodeLinkBody({ roomId: new Uint8Array([9, 8, 7, 6]), from: 0xa1b2c3d4, kind: LinkKind.Chat, counter: 77 }, new Uint8Array([1, 2, 3]));
    const res = decodeOnAir(encodeOnAir(body, getProfile("fast")));
    if (res.kind !== "ok" || res.packet.kind !== "link") throw new Error("expected a link packet");
    const p = res.packet;
    expect(Array.from(p.roomId)).toEqual([9, 8, 7, 6]);
    expect(p.from).toBe(0xa1b2c3d4);
    expect(p.linkKind).toBe(LinkKind.Chat);
    expect(p.counter).toBe(77);
    expect(Array.from(p.payload)).toEqual([1, 2, 3]);
    expect(p.header.length).toBe(14);
    expect(Array.from(p.header)).toEqual(Array.from(body.subarray(0, 14)));
  });

  it("limits the payload so that one packet always fits", () => {
    for (const profile of AUDIO_PROFILES) {
      const max = maxLinkPayload(profile);
      expect(max).toBe(255 - profile.parity - 18);
      const body = encodeLinkBody({ roomId: new Uint8Array(4), from: 1, kind: 5, counter: 1 }, new Uint8Array(max));
      expect(() => encodeOnAir(body, profile)).not.toThrow();
      expect(parseAudioPacket(body).kind).toBe("ok");
    }
    // A chat message (rseq + 180 bytes + GCM tag) fits every profile.
    for (const profile of AUDIO_PROFILES) expect(4 + MAX_CHAT_BYTES + 16).toBeLessThanOrEqual(maxLinkPayload(profile));
  });
});

describe("link payload codecs", () => {
  const pub = new Uint8Array(65).map((_, i) => i);

  it("beacon and join", () => {
    expect(decodeBeacon(encodeBeacon({ publicRaw: pub, profileIndex: 1, name: "Swift Crimson Falcon" }))).toEqual({ publicRaw: pub, profileIndex: 1, name: "Swift Crimson Falcon" });
    expect(decodeJoin(encodeJoin({ publicRaw: pub, name: "Calm Jade Otter" }))).toEqual({ publicRaw: pub, name: "Calm Jade Otter" });
    expect(decodeBeacon(new Uint8Array(10))).toBeNull();
  });

  it("welcome and members", () => {
    const members = [{ id: 1, fp: fp(1) }, { id: 0xffffffff, fp: fp(2) }];
    const w = { target: 0xffffffff, epoch: 3, groupKey: new Uint8Array(32).fill(5), members };
    expect(decodeWelcome(encodeWelcome(w))).toEqual(w);
    expect(decodeMembers(encodeMembers({ epoch: 4, members }))).toEqual({ epoch: 4, members });
  });

  it("chat, presence, leave and file-done", () => {
    expect(decodeChat(encodeChat({ rseq: 42, text: "Salut 👋" }))).toEqual({ rseq: 42, text: "Salut 👋" });
    const presence = { name: "Calm Jade Otter", acks: [{ id: 7, rseq: 3 }, { id: 9, rseq: 0 }] };
    expect(decodePresence(encodePresence(presence))).toEqual(presence);
    expect(decodeRseqOnly(encodeRseqOnly(12))).toBe(12);
    expect(decodeFileDone(encodeFileDone({ rseq: 5, transferId: new Uint8Array([1, 2, 3, 4]) }))).toEqual({ rseq: 5, transferId: new Uint8Array([1, 2, 3, 4]) });
  });

  it("truncates chat text to MAX_CHAT_BYTES on a character boundary", () => {
    const long = "é".repeat(200);
    const decoded = decodeChat(encodeChat({ rseq: 1, text: long }));
    expect(new TextEncoder().encode(decoded!.text).length).toBeLessThanOrEqual(MAX_CHAT_BYTES);
    expect(decoded!.text.includes("�")).toBe(false);
  });
});
