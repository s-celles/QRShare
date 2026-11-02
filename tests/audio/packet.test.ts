import { describe, expect, it, spyOn } from "bun:test";
import {
  AUDIO_PACKET_VERSION,
  encodeDataBody,
  encodeMetadataBody,
  encodeOnAir,
  decodeHeader,
  decodeBody,
  decodeOnAir,
  parseAudioPacket,
  truncateFilename,
  maxFilenameBytes,
} from "@/audio/packet";
import { AUDIO_PROFILES, getProfile, HEADER_CODEWORD_BYTES } from "@/audio/profiles";
import { crc32 } from "@/audio/crc32";
import { rsEncode } from "@/audio/reed-solomon";
import { PROTOCOL_VERSION, type Frame } from "@/protocol/frame";
import { randomBytes, prng } from "./helpers";

const hash = new Uint8Array([1, 2, 3, 4]);

function metaFrame(filename: string): Omit<Frame, "symbolId" | "payload" | "version"> {
  return {
    flags: 0x03,
    metadataHash: hash,
    sourceBlockCount: 13,
    blockSize: 48,
    compressedSize: 600,
    compressionId: 0x01,
    filename,
    fileSize: 1000,
    sha256: new Uint8Array(32).fill(7),
  };
}

describe("audio data packets (REQ-AUD-070, 071)", () => {
  it("encodes type/version, hash, symbolId LE, symbol and CRC32", () => {
    const symbol = randomBytes(48, 1);
    const body = encodeDataBody(hash, 0x1234, symbol);
    expect(body.length).toBe(11 + 48);
    expect(body[0]).toBe(AUDIO_PACKET_VERSION << 4);
    expect(body.subarray(1, 5)).toEqual(hash);
    expect(body[5]).toBe(0x34);
    expect(body[6]).toBe(0x12);
    const crc = new DataView(body.buffer).getUint32(body.length - 4, true);
    expect(crc).toBe(crc32(body.subarray(0, body.length - 4)));

    const parsed = parseAudioPacket(body);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok" && parsed.packet.kind === "data") {
      expect(parsed.packet.symbolId).toBe(0x1234);
      expect(parsed.packet.symbol).toEqual(symbol);
      expect(parsed.packet.metadataHash).toEqual(hash);
    } else throw new Error("expected data packet");
  });

  it("rejects symbolId 0 and out-of-range ids", () => {
    expect(() => encodeDataBody(hash, 0, new Uint8Array(4))).toThrow();
    expect(() => encodeDataBody(hash, 65536, new Uint8Array(4))).toThrow();
  });

  it("round-trips through the on-air header + body codewords for every profile", () => {
    for (const profile of AUDIO_PROFILES) {
      const body = encodeDataBody(hash, 7, randomBytes(profile.blockSize, 2));
      const air = encodeOnAir(body, profile);
      expect(air.length).toBe(HEADER_CODEWORD_BYTES + body.length + profile.parity);
      const hdr = decodeHeader(air.subarray(0, HEADER_CODEWORD_BYTES));
      expect(hdr.ok).toBe(true);
      if (hdr.ok) {
        expect(hdr.bodyLen).toBe(body.length);
        expect(hdr.profile.id).toBe(profile.id);
      }
      const res = decodeOnAir(air);
      expect(res.kind).toBe("ok");
    }
  });
});

describe("audio metadata packets (REQ-AUD-072)", () => {
  it("wraps a v3 frame with symbolId 0 and an empty payload", () => {
    const body = encodeMetadataBody(metaFrame("notes.txt"), getProfile("robust"));
    expect(body[0]).toBe((AUDIO_PACKET_VERSION << 4) | 1);
    expect(body[1]).toBe(PROTOCOL_VERSION);
    expect(body.length).toBe(62 + "notes.txt".length);
    const parsed = parseAudioPacket(body);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok" && parsed.packet.kind === "metadata") {
      const f = parsed.packet.frame;
      expect(f.symbolId).toBe(0);
      expect(f.payload.length).toBe(0);
      expect(f.filename).toBe("notes.txt");
      expect(f.flags).toBe(0x03);
      expect(f.sourceBlockCount).toBe(13);
      expect(f.blockSize).toBe(48);
      expect(f.compressedSize).toBe(600);
      expect(f.fileSize).toBe(1000);
      expect(f.metadataHash).toEqual(hash);
    } else throw new Error("expected metadata packet");
  });
});

describe("filename truncation (REQ-AUD-073)", () => {
  it("computes the per-profile filename budget", () => {
    expect(maxFilenameBytes(getProfile("robust"))).toBe(177);
    expect(maxFilenameBytes(getProfile("fast"))).toBe(181);
    expect(maxFilenameBytes(getProfile("ultrasonic"))).toBe(177);
  });

  it("keeps short names unchanged", () => {
    expect(truncateFilename("a.txt", 177)).toBe("a.txt");
  });

  it("truncates the stem on a code-point boundary and keeps the extension", () => {
    const name = "é".repeat(150) + ".tar.gz";
    const out = truncateFilename(name, 100);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".gz")).toBe(true);
    expect(out.includes("�")).toBe(false);
    expect(out.startsWith("é")).toBe(true);
  });

  it("handles emoji (4-byte code points) and names without extension", () => {
    const out = truncateFilename("😀".repeat(100), 30);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(30);
    expect([...out].every((c) => c === "😀")).toBe(true);
  });

  it("fits every profile's body budget", () => {
    for (const profile of AUDIO_PROFILES) {
      const body = encodeMetadataBody(metaFrame("x".repeat(400) + ".pdf"), profile);
      expect(body.length + profile.parity).toBeLessThanOrEqual(255);
      const parsed = parseAudioPacket(body);
      if (parsed.kind !== "ok" || parsed.packet.kind !== "metadata") throw new Error("parse failed");
      expect(parsed.packet.frame.filename.endsWith(".pdf")).toBe(true);
    }
  });
});

describe("packet rejection paths (REQ-AUD-074, 078)", () => {
  const profile = getProfile("robust");

  it("rejects an unknown version nibble with a warning", () => {
    const body = encodeDataBody(hash, 1, new Uint8Array(8));
    body[0] = 0x20; // version 2
    const fixedCrc = crc32(body.subarray(0, body.length - 4));
    new DataView(body.buffer).setUint32(body.length - 4, fixedCrc, true);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const res = parseAudioPacket(body);
    expect(res).toEqual({ kind: "rejected", reason: "version" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a CRC mismatch even when the RS codeword is valid", () => {
    const body = encodeDataBody(hash, 1, new Uint8Array(8));
    body[9] ^= 0xff; // corrupt the symbol, keep the old CRC
    const codeword = rsEncode(body, profile.parity); // a valid codeword of the wrong body
    expect(decodeBody(codeword, profile.parity)).toEqual({ kind: "rejected", reason: "crc" });
  });

  it("rejects too many byte errors as body_rs", () => {
    const body = encodeDataBody(hash, 1, randomBytes(48, 3));
    const codeword = rsEncode(body, profile.parity);
    for (let i = 0; i < 12; i++) codeword[i * 3] ^= 0x5a;
    expect(decodeBody(codeword, profile.parity)).toEqual({ kind: "rejected", reason: "body_rs" });
  });

  it("corrects errors and erasures within capacity", () => {
    const body = encodeDataBody(hash, 9, randomBytes(48, 4));
    const codeword = rsEncode(body, profile.parity);
    const erasures = [0, 10, 20, 30, 40, 50];
    for (const p of erasures) codeword[p] ^= 0x33;
    codeword[60] ^= 1;
    codeword[61] ^= 2;
    const res = decodeBody(codeword, profile.parity, erasures);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.correctedBytes).toBe(8);
  });

  it("rejects a corrupted header as header_rs", () => {
    const air = encodeOnAir(encodeDataBody(hash, 1, new Uint8Array(8)), profile);
    const hdr = new Uint8Array(air.subarray(0, 7));
    hdr[0] ^= 1;
    hdr[1] ^= 1;
    hdr[2] ^= 1;
    expect(decodeHeader(hdr).ok).toBe(false);
  });

  it("CRC32 catches every RS miscorrection in a seeded fuzz", () => {
    const r = prng(77);
    let accepted = 0;
    let wrong = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const body = encodeDataBody(hash, 1 + trial, randomBytes(48, trial));
      const codeword = rsEncode(body, profile.parity);
      const n = 9 + Math.floor(r() * 20);
      for (let i = 0; i < n; i++) codeword[Math.floor(r() * codeword.length)] ^= 1 + Math.floor(r() * 255);
      const res = decodeBody(codeword, profile.parity);
      if (res.kind === "ok") {
        accepted++;
        if (res.packet.kind !== "data" || res.packet.symbolId !== 1 + trial) wrong++;
      }
    }
    expect(wrong).toBe(0);
    // Overlapping random positions can leave ≤ 8 distinct errors, which are legitimately corrected.
    expect(accepted).toBeLessThan(3000);
  });
});
