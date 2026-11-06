/**
 * Offline checks of a paste statement and its proof, and the (explorer-trusting)
 * Bitcoin check (REQ-PASTE-092, 093, 094). The trust-minimised verification is
 * `ots verify paste-<id>.statement.ots` with one's own Bitcoin node.
 */
import { describeAuthor, toHex } from "../keys";
import { decodeStatement, pasteIdOf, verifyStatement, type AttachmentRef, type StatementFields } from "../statement";
import { parseOtsFile, proofSummary, type OtsFile, type ProofSummary } from "./file";
import type { BitcoinCheckResult } from "./status";
import { allAttestations } from "./timestamp";

export const DEFAULT_EXPLORERS: readonly string[] = ["https://blockstream.info/api", "https://mempool.space/api"];
const EXPLORER_TIMEOUT_MS = 10_000;

export interface AttestationView {
  kind: "pending" | "bitcoin" | "unknown";
  uri?: string;
  height?: number;
  /** Hex of the message the attestation commits to (absent under unsupported operations). */
  commitmentHex?: string;
  supported: boolean;
}

export interface ProofCheck {
  file: OtsFile;
  digestMatches: boolean;
  summary: ProofSummary;
  attestations: AttestationView[];
}

/** Parses the proof (replaying every operation) and compares its digest with the file's. */
export async function checkProof(statement: Uint8Array, ots: Uint8Array): Promise<ProofCheck> {
  const file = await parseOtsFile(ots);
  const digest = await pasteIdOf(statement);
  const attestations = allAttestations(file.timestamp).map(({ msg, attestation }): AttestationView => {
    const commitmentHex = msg ? toHex(msg) : undefined;
    if (attestation.kind === "pending") return { kind: "pending", uri: attestation.uri, commitmentHex, supported: !!msg };
    if (attestation.kind === "bitcoin") return { kind: "bitcoin", height: attestation.height, commitmentHex, supported: !!msg };
    return { kind: "unknown", supported: false };
  });
  return { file, digestMatches: toHex(digest) === toHex(file.digest), summary: proofSummary(file), attestations };
}

export interface StatementCheck {
  id: Uint8Array;
  fields?: StatementFields;
  fingerprint?: string;
  pseudonym?: string;
  signature: "valid" | "invalid" | "not-checked";
  attachments: { ref: AttachmentRef; status: "match" | "missing"; file?: string }[];
  /** Given files that match no listed attachment. */
  extraFiles: string[];
  error?: string;
}

export async function checkStatement(
  statement: Uint8Array,
  opts: { signature?: Uint8Array; attachments?: { name: string; bytes: Uint8Array }[] },
): Promise<StatementCheck> {
  const id = await pasteIdOf(statement);
  let fields: StatementFields;
  try {
    fields = decodeStatement(statement);
  } catch (err) {
    return { id, signature: "not-checked", attachments: [], extraFiles: [], error: (err as Error).message };
  }
  const author = await describeAuthor(fields.author);
  const signature = !opts.signature ? "not-checked" : (await verifyStatement(statement, opts.signature, fields.author)) ? "valid" : "invalid";
  const files = await Promise.all((opts.attachments ?? []).map(async (f) => ({ name: f.name, size: f.bytes.length, hash: toHex(await pasteIdOf(f.bytes)) })));
  const used = new Set<string>();
  const attachments = fields.attachments.map((ref) => {
    const hash = toHex(ref.hash);
    const file = files.find((f) => f.hash === hash && f.size === ref.size);
    if (file) used.add(file.name);
    return { ref, status: file ? ("match" as const) : ("missing" as const), file: file?.name };
  });
  return {
    id,
    fields,
    fingerprint: author.fingerprint,
    pseudonym: author.identity.name,
    signature,
    attachments,
    extraFiles: files.filter((f) => !used.has(f.name)).map((f) => f.name),
  };
}

export interface BitcoinCheck {
  ok: boolean;
  explorer: string;
  blockHash: string;
  /** Merkle root as shown by explorers (reversed byte order). */
  merkleRoot: string;
  /** Block header time, seconds since the epoch. */
  time: number;
}

async function getWithTimeout(doFetch: typeof fetch, url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPLORER_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error(`Explorer answered ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** Compares the attested commitment with the Merkle root of block `height` (trusts the explorer). */
export async function checkBitcoinAttestation(
  height: number,
  commitment: Uint8Array,
  opts: { fetch?: typeof fetch; explorers?: readonly string[] } = {},
): Promise<BitcoinCheck> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const expected = toHex(Uint8Array.from(commitment).reverse());
  let lastError: unknown;
  for (const explorer of opts.explorers ?? DEFAULT_EXPLORERS) {
    try {
      const blockHash = (await (await getWithTimeout(doFetch, `${explorer}/block-height/${height}`)).text()).trim();
      if (!/^[0-9a-f]{64}$/.test(blockHash)) throw new Error("Bad block hash");
      const block = (await (await getWithTimeout(doFetch, `${explorer}/block/${blockHash}`)).json()) as { merkle_root?: string; timestamp?: number; height?: number };
      if (typeof block.merkle_root !== "string" || typeof block.timestamp !== "number") throw new Error("Bad block");
      if (block.height !== undefined && block.height !== height) throw new Error("Wrong block");
      const merkleRoot = block.merkle_root.toLowerCase();
      return { ok: merkleRoot === expected, explorer, blockHash, merkleRoot, time: block.timestamp };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No block explorer answered");
}

/**
 * Checks every Bitcoin attestation of a proof once per (height, commitment). A lookup
 * that fails (e.g. a forged height no explorer knows) is recorded as an error result for
 * that attestation only; the others are still checked.
 */
export async function checkBitcoinAttestations(
  file: OtsFile,
  check: (height: number, commitment: Uint8Array) => Promise<BitcoinCheck> = (h, c) => checkBitcoinAttestation(h, c),
): Promise<BitcoinCheckResult[]> {
  const results: BitcoinCheckResult[] = [];
  const seen = new Set<string>();
  for (const a of allAttestations(file.timestamp)) {
    if (a.attestation.kind !== "bitcoin" || !a.msg) continue;
    const height = a.attestation.height;
    const commitmentHex = toHex(a.msg);
    if (seen.has(`${height}:${commitmentHex}`)) continue;
    seen.add(`${height}:${commitmentHex}`);
    try {
      const r = await check(height, a.msg);
      results.push({ height, commitmentHex, ok: r.ok, time: r.time, explorer: new URL(r.explorer).host });
    } catch (err) {
      results.push({ height, commitmentHex, ok: false, time: 0, explorer: "", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
