import { describe, expect, it } from "bun:test";
import { checkBitcoinAttestation, checkProof, checkStatement, DEFAULT_EXPLORERS } from "@/paste/ots/verify";
import { encodeStatement, signStatement } from "@/paste/statement";
import { attachmentRef, createAuthor, fields } from "../helpers";
import { FX, fixture, hex, unhex } from "./fixtures";

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));

describe("REQ-PASTE-092 checking a proof", () => {
  it("checks the file digest and replays the operations to each attestation", async () => {
    const statement = fixture("pending.txt");
    const result = await checkProof(statement, fixture("complete.txt.ots"));
    expect(result.digestMatches).toBe(true);
    expect(result.summary.status).toBe("bitcoin");
    const bitcoin = result.attestations.find((a) => a.kind === "bitcoin")!;
    expect(bitcoin.height).toBe(912345);
    expect(bitcoin.commitmentHex).toBe(FX.merkleRootInternalHex);
    expect(result.attestations.filter((a) => a.kind === "pending").length).toBe(4);
  });

  it("reports a digest mismatch", async () => {
    const result = await checkProof(new TextEncoder().encode("another file"), fixture("pending.txt.ots"));
    expect(result.digestMatches).toBe(false);
  });

  it("REQ-PASTE-094 flags unsupported content", async () => {
    const result = await checkProof(new Uint8Array(0), fixture("unsupported.ots"));
    expect(result.summary.unsupported).toBe(true);
    expect(result.attestations.some((a) => a.kind === "unknown" || !a.supported)).toBe(true);
  });

  it("checks a statement, its signature and its attachment files", async () => {
    const author = await createAuthor();
    const pdf = new Uint8Array([1, 2, 3]);
    const statement = encodeStatement(await fields(author, { attachments: [await attachmentRef(pdf, { name: "a.pdf" }), await attachmentRef(new Uint8Array([9]), { name: "b.pdf" })] }));
    const signature = await signStatement(statement, author.key.privateKey);
    const result = await checkStatement(statement, { signature, attachments: [{ name: "renamed.bin", bytes: pdf }, { name: "x", bytes: new Uint8Array([7]) }] });
    expect(result.error).toBeUndefined();
    expect(hex(result.id)).toBe(hex(await sha256(statement)));
    expect(result.signature).toBe("valid");
    expect(result.fingerprint).toBe(author.fingerprint);
    expect(result.attachments.map((a) => a.status)).toEqual(["match", "missing"]);
    expect(result.extraFiles).toEqual(["x"]);

    const bad = signature.slice();
    bad[0] ^= 1;
    expect((await checkStatement(statement, { signature: bad })).signature).toBe("invalid");
    expect((await checkStatement(statement, {})).signature).toBe("not-checked");
    expect((await checkStatement(new Uint8Array([1, 2, 3]), {})).error).toBeDefined();
  });
});

describe("REQ-PASTE-093 Bitcoin check through a block explorer", () => {
  const commitment = unhex(FX.merkleRootInternalHex);
  const blockHash = "00000000000000000001aaaa" + "0".repeat(40);
  const esplora = (merkleRoot: string) =>
    (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${DEFAULT_EXPLORERS[0]}/block-height/912345`) return new Response(blockHash);
      if (url === `${DEFAULT_EXPLORERS[0]}/block/${blockHash}`) return Response.json({ id: blockHash, height: 912345, merkle_root: merkleRoot, timestamp: 1_790_000_000 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

  it("matches the Merkle root in display byte order", async () => {
    const result = await checkBitcoinAttestation(912345, commitment, { fetch: esplora(FX.merkleRootDisplayHex) });
    expect(result.ok).toBe(true);
    expect(result.blockHash).toBe(blockHash);
    expect(result.time).toBe(1_790_000_000);
    expect(result.explorer).toBe(DEFAULT_EXPLORERS[0]);
  });

  it("reports a mismatch, including the internal byte order", async () => {
    expect((await checkBitcoinAttestation(912345, commitment, { fetch: esplora("00".repeat(32)) })).ok).toBe(false);
    expect((await checkBitcoinAttestation(912345, commitment, { fetch: esplora(FX.merkleRootInternalHex) })).ok).toBe(false);
  });

  it("falls back to the next explorer and fails when none answers", async () => {
    const calls: string[] = [];
    const down = (async (input: string | URL | Request) => {
      calls.push(String(input));
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await expect(checkBitcoinAttestation(912345, commitment, { fetch: down })).rejects.toThrow();
    expect(calls.some((c) => c.startsWith(DEFAULT_EXPLORERS[1]))).toBe(true);
  });
});
