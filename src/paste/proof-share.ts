/**
 * Only a paste's author may share a proof with the room (REQ-PASTE-084): a PROOF frame
 * carries an Ed25519 signature by the author's session key — the key that signed the
 * paste statement — over a domain-separated message:
 *
 *   "qrshare-paste-proof-v1" ‖ room tag (16) ‖ paste id (32) ‖ sequence (u64 BE) ‖
 *   SHA-256(.ots bytes) (32)
 *
 * The sequence grows with every proof the author shares, so receivers keep the newest
 * one and ignore replays of older ones. Peers check the signature against the
 * statement's author before accepting a proof, and relay it unchanged, so it spreads to
 * peers not connected to the author.
 */

export const PROOF_SIGNATURE_LABEL = "qrshare-paste-proof-v1";

const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export async function proofMessage(tag: Uint8Array, id: Uint8Array, seq: number, ots: Uint8Array): Promise<Uint8Array> {
  const label = new TextEncoder().encode(PROOF_SIGNATURE_LABEL);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bs(ots)));
  const out = new Uint8Array(label.length + tag.length + id.length + 8 + digest.length);
  let o = 0;
  for (const part of [label, tag, id]) {
    out.set(part, o);
    o += part.length;
  }
  new DataView(out.buffer).setBigUint64(o, BigInt(seq));
  out.set(digest, o + 8);
  return out;
}

export async function signSharedProof(privateKey: CryptoKey, tag: Uint8Array, id: Uint8Array, seq: number, ots: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bs(await proofMessage(tag, id, seq, ots))));
}

export async function verifySharedProof(author: Uint8Array, tag: Uint8Array, id: Uint8Array, seq: number, ots: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (signature.length !== 64 || !Number.isSafeInteger(seq) || seq < 0) return false;
  try {
    const key = await crypto.subtle.importKey("raw", bs(author), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bs(signature), bs(await proofMessage(tag, id, seq, ots)));
  } catch {
    return false;
  }
}
