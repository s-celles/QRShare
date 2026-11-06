import { describe, expect, it } from "bun:test";
import { checkBitcoinAttestations } from "@/paste/ots/verify";
import { newOtsFile } from "@/paste/ots/file";
import { addOp } from "@/paste/ots/timestamp";

describe("REQ-PASTE-093 checking every Bitcoin attestation", () => {
  it("records an error for one attestation without aborting the others", async () => {
    const file = newOtsFile(new Uint8Array(32).fill(1));
    for (const [arg, height] of [[1, 900000], [2, 99999999], [3, 900001]] as const) {
      (await addOp(file.timestamp, { kind: "append", arg: Uint8Array.of(arg) })).attestations.push({ kind: "bitcoin", height });
    }
    const calls: number[] = [];
    const results = await checkBitcoinAttestations(file, async (height) => {
      calls.push(height);
      if (height === 99999999) throw new Error("404 on every explorer");
      return { ok: height === 900000, explorer: "https://blockstream.info/api", blockHash: "h", merkleRoot: "m", time: 1_700_000_000 };
    });
    expect(calls.sort()).toEqual([900000, 900001, 99999999]);
    const byHeight = Object.fromEntries(results.map((r) => [r.height, r]));
    expect(byHeight[900000]).toMatchObject({ ok: true, explorer: "blockstream.info" });
    expect(byHeight[900001]).toMatchObject({ ok: false });
    expect(byHeight[99999999]).toMatchObject({ ok: false, error: "404 on every explorer" });
    expect(results.every((r) => /^[0-9a-f]+$/.test(r.commitmentHex))).toBe(true);
  });

  it("checks each (height, commitment) once", async () => {
    const file = newOtsFile(new Uint8Array(32).fill(1));
    const a = await addOp(file.timestamp, { kind: "append", arg: Uint8Array.of(1) });
    a.attestations.push({ kind: "bitcoin", height: 5 });
    let n = 0;
    await checkBitcoinAttestations(file, async () => {
      n++;
      return { ok: true, explorer: "https://x.example", blockHash: "h", merkleRoot: "m", time: 0 };
    });
    expect(n).toBe(1);
  });
});
