/**
 * Detached `.ots` files (REQ-PASTE-082): magic, major version 1, SHA-256 file hash
 * op, the 32-byte file digest, then the timestamp tree rooted at that digest.
 * For a paste, the file is `paste-<id>.statement` and the digest is the paste id.
 */
import { OtsError, Reader, Writer } from "./varint";
import {
  Timestamp,
  allAttestations,
  cloneTimestamp,
  computeMessages,
  hasUnsupported,
  mergeTimestamp,
  readTimestamp,
  writeTimestamp,
} from "./timestamp";

export { OtsError };

export const OTS_MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf,
  0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
export const MAX_OTS_BYTES = 16 * 1024;
const SHA256_OP = 0x08;

export interface OtsFile {
  /** SHA-256 of the timestamped file. */
  digest: Uint8Array;
  timestamp: Timestamp;
}

export function newOtsFile(digest: Uint8Array): OtsFile {
  return { digest, timestamp: new Timestamp(digest) };
}

export async function parseOtsFile(bytes: Uint8Array, maxBytes = MAX_OTS_BYTES): Promise<OtsFile> {
  if (bytes.length > maxBytes) throw new OtsError("Proof too large");
  const r = new Reader(bytes);
  const magic = r.take(OTS_MAGIC.length);
  if (!OTS_MAGIC.every((v, i) => magic[i] === v)) throw new OtsError("Not an OpenTimestamps proof (bad magic)");
  if (r.varuint() !== 1) throw new OtsError("Unsupported proof version");
  if (r.byte() !== SHA256_OP) throw new OtsError("Only SHA-256 file hashes are supported");
  const digest = r.take(32);
  const timestamp = readTimestamp(r);
  if (!r.atEnd()) throw new OtsError("Trailing bytes after the proof");
  await computeMessages(timestamp, digest);
  return { digest, timestamp };
}

export function serializeOtsFile(file: OtsFile): Uint8Array {
  const w = new Writer();
  w.bytes(OTS_MAGIC);
  w.varuint(1);
  w.byte(SHA256_OP);
  w.bytes(file.digest);
  writeTimestamp(w, file.timestamp);
  return w.finish();
}

/**
 * Union of two proofs of the same file, as the reference library merges. Nothing is
 * pruned: a proof received from a peer may carry forged Bitcoin attestations, which
 * must never remove the real pending ones (only `upgradeProof` prunes, for the
 * calendar that answered).
 */
export function mergeOtsFiles(a: OtsFile, b: OtsFile): OtsFile {
  if (a.digest.length !== b.digest.length || !a.digest.every((v, i) => v === b.digest[i])) throw new OtsError("Proofs of different files");
  const timestamp = cloneTimestamp(a.timestamp);
  mergeTimestamp(timestamp, b.timestamp);
  return { digest: a.digest, timestamp };
}

/** Number of attestations and of distinct pending calendars in a proof. */
export function attestationCounts(file: OtsFile): { attestations: number; calendars: number; bitcoin: number } {
  const all = allAttestations(file.timestamp);
  return {
    attestations: all.length,
    calendars: new Set(all.flatMap((a) => (a.attestation.kind === "pending" ? [a.attestation.uri] : []))).size,
    bitcoin: all.filter((a) => a.attestation.kind === "bitcoin").length,
  };
}

export interface ProofSummary {
  status: "none" | "pending" | "bitcoin";
  /** Calendars still holding a pending attestation. */
  calendars: string[];
  /** Bitcoin block heights attested. */
  heights: number[];
  unsupported: boolean;
}

export function proofSummary(file: OtsFile): ProofSummary {
  const atts = allAttestations(file.timestamp);
  const calendars = [...new Set(atts.flatMap((a) => (a.attestation.kind === "pending" ? [a.attestation.uri] : [])))];
  const heights = [...new Set(atts.flatMap((a) => (a.attestation.kind === "bitcoin" && a.msg ? [a.attestation.height] : [])))].sort((x, y) => x - y);
  return {
    status: heights.length ? "bitcoin" : calendars.length ? "pending" : "none",
    calendars,
    heights,
    unsupported: hasUnsupported(file.timestamp),
  };
}
