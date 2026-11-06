/**
 * Only a paste's author may share a proof with the room (REQ-PASTE-084): a PROOF frame
 * carries an Ed25519 signature by the author's session key — the key that signed the
 * paste statement — over a domain-separated message:
 *
 *   "qrshare-paste-proof-v1" ‖ room tag (16) ‖ paste id (32) ‖ SHA-256(.ots bytes) (32)
 *
 * Peers check it against the statement's author before accepting a proof, and relay the
 * signed proof unchanged, so it spreads to peers not connected to the author.
 */

export const PROOF_SIGNATURE_LABEL = "qrshare-paste-proof-v1";

const bs = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export async function proofMessage(tag: Uint8Array, id: Uint8Array, ots: Uint8Array): Promise<Uint8Array> {
  const label = new TextEncoder().encode(PROOF_SIGNATURE_LABEL);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bs(ots)));
  const out = new Uint8Array(label.length + tag.length + id.length + digest.length);
  out.set(label);
  out.set(tag, label.length);
  out.set(id, label.length + tag.length);
  out.set(digest, label.length + tag.length + id.length);
  return out;
}

export async function signSharedProof(privateKey: CryptoKey, tag: Uint8Array, id: Uint8Array, ots: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bs(await proofMessage(tag, id, ots))));
}

export async function verifySharedProof(author: Uint8Array, tag: Uint8Array, id: Uint8Array, ots: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", bs(author), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bs(signature), bs(await proofMessage(tag, id, ots)));
  } catch {
    return false;
  }
}
