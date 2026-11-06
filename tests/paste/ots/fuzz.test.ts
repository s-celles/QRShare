import { describe, expect, it } from "bun:test";
import { OtsError, mergeOtsFiles, parseOtsFile, proofSummary, serializeOtsFile } from "@/paste/ots/file";
import { upgradeProof } from "@/paste/ots/calendar";
import { addOp, allAttestations } from "@/paste/ots/timestamp";
import { Writer } from "@/paste/ots/varint";
import { FX, fixture, hex, unhex } from "./fixtures";

const FIXTURES = ["pending.txt.ots", "complete.txt.ots", "unsupported.ots", "stamp-golden.ots"];
const BITCOIN = unhex("0588960d73d71901");

/** Expects either a parsed proof or an OtsError — never another exception or a hang. */
async function parsesOrRejects(bytes: Uint8Array) {
  try {
    await parseOtsFile(bytes);
  } catch (err) {
    expect(err).toBeInstanceOf(OtsError);
  }
}

describe("OTS parser fuzzing", () => {
  it("rejects every truncation of every fixture with an OtsError", async () => {
    for (const name of FIXTURES) {
      const bytes = fixture(name);
      for (let n = 0; n < bytes.length; n++) await expect(parseOtsFile(bytes.subarray(0, n))).rejects.toBeInstanceOf(OtsError);
    }
  });

  it("survives random byte mutations", async () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const name of FIXTURES) {
      const bytes = fixture(name);
      for (let i = 0; i < 300; i++) {
        const m = bytes.slice();
        for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) m[Math.floor(rand() * m.length)] = Math.floor(rand() * 256);
        await parsesOrRejects(m);
      }
    }
  });

  it("rejects truncated or oversized varbytes", async () => {
    const header = fixture("pending.txt.ots").subarray(0, 65);
    // append whose length claims more bytes than present
    await expect(parseOtsFile(new Uint8Array([...header, 0xf0, 0x20, 1, 2, 3]))).rejects.toBeInstanceOf(OtsError);
    // append whose length exceeds the message limit
    await expect(parseOtsFile(new Uint8Array([...header, 0xf0, 0x81, 0x40, 0]))).rejects.toBeInstanceOf(OtsError);
    // empty append argument
    await expect(parseOtsFile(new Uint8Array([...header, 0xf0, 0x00]))).rejects.toBeInstanceOf(OtsError);
    // attestation payload length beyond the file
    await expect(parseOtsFile(new Uint8Array([...header, 0x00, ...BITCOIN, 0xff, 0xff, 0x03]))).rejects.toBeInstanceOf(OtsError);
  });

  it("accepts a tree at the depth limit and rejects one beyond it", async () => {
    const header = fixture("pending.txt.ots").subarray(0, 65);
    const chain = (n: number) => new Uint8Array([...header, ...new Array(n).fill(0x08), 0x00, ...BITCOIN, 1, 1]);
    await expect(parseOtsFile(chain(255))).resolves.toBeDefined();
    await expect(parseOtsFile(chain(256))).rejects.toThrow(/depth/i);
  });

  it("parses a wide tree within the size limit and refuses repeated operations", async () => {
    const header = fixture("pending.txt.ots").subarray(0, 65);
    const w = new Writer();
    w.bytes(header);
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (i < n - 1) w.byte(0xff);
      w.byte(0xf0);
      w.varbytes(Uint8Array.of(i >> 8, i & 255));
      w.byte(0x00);
      w.bytes(BITCOIN);
      w.varbytes(Uint8Array.of(1));
    }
    const wide = w.finish();
    expect(wide.length).toBeLessThan(16 * 1024);
    const file = await parseOtsFile(wide);
    expect(allAttestations(file.timestamp).length).toBe(n);
    expect(hex(serializeOtsFile(file))).toBe(hex(wide));
    const dup = new Uint8Array([...header, 0xff, 0x08, 0x00, ...BITCOIN, 1, 1, 0x08, 0x00, ...BITCOIN, 1, 2]);
    await expect(parseOtsFile(dup)).rejects.toThrow(/repeated/i);
  });
});

describe("REQ-PASTE-090 pruning only where a calendar answered", () => {
  async function poisoned() {
    const file = await parseOtsFile(fixture("pending.txt.ots"));
    for (const a of allAttestations(file.timestamp)) {
      if (a.attestation.kind === "pending") (await addOp(a.node, { kind: "append", arg: Uint8Array.of(0xee) })).attestations.push({ kind: "bitcoin", height: 1 });
    }
    return file;
  }

  it("keeps every pending attestation when merging a forged Bitcoin branch", async () => {
    const pending = await parseOtsFile(fixture("pending.txt.ots"));
    const merged = mergeOtsFiles(pending, await poisoned());
    expect(proofSummary(merged).calendars.length).toBe(4);
    expect(proofSummary(mergeOtsFiles(merged, pending)).calendars.length).toBe(4);
  });

  it("an upgrade prunes only the calendar that supplied the Bitcoin path", async () => {
    const target = `${FX.upgradeUri}/timestamp/${FX.upgradeCommitmentHex}`;
    const fetch = (async (input: string | URL | Request) =>
      String(input) === target ? new Response(fixture("upgrade.bin") as BodyInit) : Promise.reject(new TypeError("pending"))) as unknown as typeof globalThis.fetch;
    const result = await upgradeProof(await poisoned(), { fetch });
    expect(result.upgraded).toEqual([FX.upgradeUri]);
    const calendars = proofSummary(result.file).calendars;
    expect(calendars).not.toContain(FX.upgradeUri);
    expect(calendars.length).toBe(3);
  });
});
