/**
 * What to show and offer for a paste's proof (REQ-PASTE-085, 090, 093), independent
 * of the interface. A Bitcoin attestation — from a calendar or from another peer — is
 * only a claim until a block check matched it; pending calendars are shown next to
 * it, and Upgrade stays available while an allow-listed calendar is pending (a forged
 * Bitcoin attestation must not hide it).
 */
import { isAllowedCalendar } from "./calendar";
import type { ProofSummary } from "./file";

export interface ProofView {
  pendingCalendars: string[];
  claimedHeights: number[];
  verifiedHeights: number[];
  canUpgrade: boolean;
  canCheckBitcoin: boolean;
}

export function describeProof(summary: ProofSummary | null, verified: number[]): ProofView {
  const heights = summary?.heights ?? [];
  const pendingCalendars = summary?.calendars ?? [];
  return {
    pendingCalendars,
    claimedHeights: heights.filter((h) => !verified.includes(h)),
    verifiedHeights: heights.filter((h) => verified.includes(h)),
    canUpgrade: pendingCalendars.some(isAllowedCalendar),
    canCheckBitcoin: heights.length > 0,
  };
}

export interface BitcoinCheckResult {
  height: number;
  /** Hex of the attested commitment (the expected Merkle root). */
  commitmentHex: string;
  ok: boolean;
  /** Block time, seconds. */
  time: number;
  explorer: string;
  /** The lookup failed (no explorer knew the block, network error): not verified. */
  error?: string;
}

/** Results of a block check, valid only for the exact proof they were computed on. */
export interface ProofChecks {
  proof: Uint8Array;
  results: BitcoinCheckResult[];
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The check results if they were computed on `proof`, none otherwise (the proof changed). */
export function currentResults(checks: ProofChecks | undefined, proof: Uint8Array | undefined): BitcoinCheckResult[] {
  return checks && proof && same(checks.proof, proof) ? checks.results : [];
}

/** Heights for which at least one attested commitment matched its block, for the current proof. */
export function verifiedHeights(checks: ProofChecks | undefined, proof: Uint8Array | undefined): number[] {
  return [...new Set(currentResults(checks, proof).filter((r) => r.ok).map((r) => r.height))].sort((a, b) => a - b);
}
