import { describe, expect, it } from "bun:test";
import { Reader, Writer } from "@/paste/ots/varint";
import { OtsError, OTS_MAGIC, mergeOtsFiles, parseOtsFile, proofSummary, serializeOtsFile } from "@/paste/ots/file";
import { allAttestations } from "@/paste/ots/timestamp";
import { FX, fixture, hex, unhex } from "./fixtures";

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));

describe("varuint / varbytes", () => {
  it("round-trips LEB128 values", () => {
    for (const n of [0, 1, 127, 128, 255, 300, 16384, 912345, 2 ** 32, 2 ** 53 - 1]) {
      const w = new Writer();
      w.varuint(n);
      const r = new Reader(w.finish());
      expect(r.varuint()).toBe(n);
      expect(r.atEnd()).toBe(true);
    }
    const w = new Writer();
    w.varuint(300);
    expect(hex(w.finish())).toBe("ac02");
  });

  it("enforces varbytes bounds and detects truncation", () => {
    const w = new Writer();
    w.varbytes(new Uint8Array([1, 2, 3]));
    expect([...new Reader(w.finish()).varbytes(3)]).toEqual([1, 2, 3]);
    expect(() => new Reader(Uint8Array.from([3, 1, 2, 3])).varbytes(2)).toThrow(OtsError);
    expect(() => new Reader(Uint8Array.from([3, 1])).varbytes(10)).toThrow(OtsError);
    expect(() => new Reader(Uint8Array.from([0x80, 0x80])).varuint()).toThrow(OtsError);
  });
});

describe("REQ-PASTE-082 .ots files", () => {
  it("parses a proof made by the reference client and re-serialises it byte for byte", async () => {
    const bytes = fixture("pending.txt.ots");
    expect(hex(bytes.subarray(0, 31))).toBe(hex(OTS_MAGIC));
    const file = await parseOtsFile(bytes);
    expect(hex(file.digest)).toBe(hex(await sha256(fixture("pending.txt"))));
    expect(hex(file.digest)).toBe(FX.pendingFileDigestHex);
    expect(hex(serializeOtsFile(file))).toBe(hex(bytes));
    const summary = proofSummary(file);
    expect(summary.status).toBe("pending");
    expect(summary.calendars.sort()).toEqual([
      "https://alice.btc.calendar.opentimestamps.org",
      "https://bob.btc.calendar.opentimestamps.org",
      "https://btc.calendar.catallaxy.com",
      "https://finney.calendar.eternitywall.com",
    ]);
    expect(summary.unsupported).toBe(false);
  });

  it("round-trips every fixture", async () => {
    for (const name of ["complete.txt.ots", "stamp-golden.ots", "unsupported.ots"]) {
      const bytes = fixture(name);
      expect(hex(serializeOtsFile(await parseOtsFile(bytes)))).toBe(hex(bytes));
    }
  });

  it("lists a Bitcoin attestation with the commitment it attests", async () => {
    const file = await parseOtsFile(fixture("complete.txt.ots"));
    const bitcoin = allAttestations(file.timestamp).filter((a) => a.attestation.kind === "bitcoin");
    expect(bitcoin.length).toBe(1);
    expect(bitcoin[0].attestation).toEqual({ kind: "bitcoin", height: 912345 });
    expect(hex(bitcoin[0].msg!)).toBe(FX.merkleRootInternalHex);
    expect(proofSummary(file).status).toBe("bitcoin");
    expect(proofSummary(file).heights).toEqual([912345]);
  });

  it("merges proofs as a pure union, like the reference library (no pruning)", async () => {
    const pending = await parseOtsFile(fixture("pending.txt.ots"));
    const complete = await parseOtsFile(fixture("complete.txt.ots"));
    const merged = mergeOtsFiles(pending, complete);
    expect(hex(serializeOtsFile(merged))).toBe(hex(fixture("complete.txt.ots")));
    const again = mergeOtsFiles(await parseOtsFile(fixture("complete.txt.ots")), await parseOtsFile(fixture("pending.txt.ots")));
    expect(hex(serializeOtsFile(again))).toBe(hex(fixture("complete.txt.ots")));
    expect(hex(serializeOtsFile(mergeOtsFiles(merged, merged)))).toBe(hex(fixture("complete.txt.ots")));
  });

  it("refuses to merge proofs of different files", async () => {
    const a = await parseOtsFile(fixture("pending.txt.ots"));
    const b = await parseOtsFile(fixture("unsupported.ots"));
    expect(() => mergeOtsFiles(a, b)).toThrow(OtsError);
  });

  it("REQ-PASTE-094 reports unsupported operations and attestations", async () => {
    const file = await parseOtsFile(fixture("unsupported.ots"));
    expect(hex(file.digest)).toBe(FX.unsupportedDigestHex);
    const summary = proofSummary(file);
    expect(summary.unsupported).toBe(true);
    const atts = allAttestations(file.timestamp);
    expect(atts.find((a) => a.attestation.kind === "unknown")).toBeDefined();
    // attestations below SHA-1 / RIPEMD-160 have no computable commitment
    expect(atts.filter((a) => a.msg === null).length).toBe(2);
  });

  it("rejects malformed files and enforces the limits", async () => {
    const good = fixture("pending.txt.ots");
    await expect(parseOtsFile(good.subarray(0, good.length - 1))).rejects.toBeInstanceOf(OtsError);
    await expect(parseOtsFile(new Uint8Array([...good, 0]))).rejects.toThrow(/trailing/i);
    const badMagic = good.slice();
    badMagic[3] ^= 1;
    await expect(parseOtsFile(badMagic)).rejects.toThrow(/magic/i);
    const badVersion = good.slice();
    badVersion[31] = 2;
    await expect(parseOtsFile(badVersion)).rejects.toThrow(/version/i);
    const badHashOp = good.slice();
    badHashOp[32] = 0x02;
    await expect(parseOtsFile(badHashOp)).rejects.toThrow(OtsError);
    await expect(parseOtsFile(new Uint8Array(16 * 1024 + 1))).rejects.toThrow(/large/i);

    const header = good.subarray(0, 32 + 1 + 32);
    // depth: 300 nested sha256 operations
    const deep = new Uint8Array([...header, ...new Array(300).fill(0x08), 0x00, ...unhex("0588960d73d71901"), 1, 1]);
    await expect(parseOtsFile(deep)).rejects.toThrow(/depth/i);
    // message length: appending 4096 bytes to a 32-byte digest exceeds 4096
    const w = new Writer();
    w.bytes(header);
    w.byte(0xf0);
    w.varbytes(new Uint8Array(4096));
    w.byte(0x00);
    w.bytes(unhex("0588960d73d71901"));
    w.varbytes(Uint8Array.from([1]));
    await expect(parseOtsFile(w.finish())).rejects.toThrow(/long/i);
    // an unknown operation tag cannot be parsed
    await expect(parseOtsFile(new Uint8Array([...header, 0x42]))).rejects.toThrow(OtsError);
  });
});
