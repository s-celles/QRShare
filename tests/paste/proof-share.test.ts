import { describe, expect, it } from "bun:test";
import { PROOF_SIGNATURE_LABEL, proofMessage, signSharedProof, verifySharedProof } from "@/paste/proof-share";
import { createAuthor } from "@/paste/keys";
import { sha256 } from "./helpers";

const tag = new Uint8Array(16).fill(1);
const id = new Uint8Array(32).fill(2);
const ots = Uint8Array.of(0, 79, 112, 101, 110);

describe("REQ-PASTE-084 author signature of shared proofs", () => {
  it("signs a domain-separated message: label, room tag, paste id, sequence, SHA-256 of the proof", async () => {
    const msg = await proofMessage(tag, id, 258, ots);
    const label = new TextEncoder().encode(PROOF_SIGNATURE_LABEL);
    const L = label.length;
    expect([...msg.subarray(0, L)]).toEqual([...label]);
    expect([...msg.subarray(L, L + 16)]).toEqual([...tag]);
    expect([...msg.subarray(L + 16, L + 48)]).toEqual([...id]);
    expect([...msg.subarray(L + 48, L + 56)]).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
    expect([...msg.subarray(L + 56)]).toEqual([...(await sha256(ots))]);
  });

  it("verifies only the author's signature over the same tag, id and bytes", async () => {
    const author = await createAuthor();
    const other = await createAuthor();
    const sig = await signSharedProof(author.key.privateKey, tag, id, 7, ots);
    expect(sig.length).toBe(64);
    expect(await verifySharedProof(author.key.publicKey, tag, id, 7, ots, sig)).toBe(true);
    expect(await verifySharedProof(other.key.publicKey, tag, id, 7, ots, sig)).toBe(false);
    expect(await verifySharedProof(author.key.publicKey, new Uint8Array(16), id, 7, ots, sig)).toBe(false);
    expect(await verifySharedProof(author.key.publicKey, tag, new Uint8Array(32), 7, ots, sig)).toBe(false);
    expect(await verifySharedProof(author.key.publicKey, tag, id, 8, ots, sig)).toBe(false); // the sequence is signed
    expect(await verifySharedProof(author.key.publicKey, tag, id, 7, Uint8Array.of(...ots, 0), sig)).toBe(false);
    const bad = sig.slice();
    bad[0] ^= 1;
    expect(await verifySharedProof(author.key.publicKey, tag, id, 7, ots, bad)).toBe(false);
    expect(await verifySharedProof(author.key.publicKey, tag, id, 7, ots, new Uint8Array(3))).toBe(false);
  });
});
