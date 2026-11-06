import { describe, expect, it } from "bun:test";
import { currentResults, describeProof, verifiedHeights, type ProofChecks } from "@/paste/ots/status";
import type { ProofSummary } from "@/paste/ots/file";

const ALICE = "https://alice.btc.calendar.opentimestamps.org";
const OTHER = "https://btc.calendar.catallaxy.com";
const summary = (over: Partial<ProofSummary>): ProofSummary => ({ status: "pending", calendars: [], heights: [], unsupported: false, ...over });

describe("REQ-PASTE-085 / REQ-PASTE-090 proof status and actions", () => {
  it("offers Upgrade while an allow-listed calendar is pending, even next to a (forged) Bitcoin attestation", () => {
    const view = describeProof(summary({ status: "bitcoin", calendars: [ALICE], heights: [1] }), []);
    expect(view.canUpgrade).toBe(true);
    expect(view.pendingCalendars).toEqual([ALICE]);
    expect(view.claimedHeights).toEqual([1]);
    expect(view.verifiedHeights).toEqual([]);
    expect(view.canCheckBitcoin).toBe(true);
  });

  it("does not offer Upgrade for calendars outside the allow-list or without pending calendars", () => {
    expect(describeProof(summary({ calendars: [OTHER] }), []).canUpgrade).toBe(false);
    expect(describeProof(summary({ status: "bitcoin", heights: [5] }), [5]).canUpgrade).toBe(false);
    expect(describeProof(null, []).canUpgrade).toBe(false);
  });

  it("separates verified heights from claimed ones", () => {
    const view = describeProof(summary({ status: "bitcoin", heights: [5, 7] }), [7]);
    expect(view.verifiedHeights).toEqual([7]);
    expect(view.claimedHeights).toEqual([5]);
  });
});

describe("REQ-PASTE-093 Bitcoin check results", () => {
  const proof = Uint8Array.of(1, 2, 3);
  const checks = (results: ProofChecks["results"]): ProofChecks => ({ proof, results });

  it("verifies a height when at least one commitment at that height matched", () => {
    const c = checks([
      { height: 900, commitmentHex: "aa", ok: false, time: 0, explorer: "x" },
      { height: 900, commitmentHex: "bb", ok: true, time: 1, explorer: "x" },
      { height: 901, commitmentHex: "cc", ok: false, time: 0, explorer: "x" },
    ]);
    expect(verifiedHeights(c, proof)).toEqual([900]);
  });

  it("forgets results once the proof has changed", () => {
    const c = checks([{ height: 900, commitmentHex: "bb", ok: true, time: 1, explorer: "x" }]);
    expect(verifiedHeights(c, Uint8Array.of(1, 2, 3, 4))).toEqual([]);
    expect(verifiedHeights(c, undefined)).toEqual([]);
    expect(verifiedHeights(undefined, proof)).toEqual([]);
    expect(currentResults(c, Uint8Array.of(9))).toEqual([]);
    expect(currentResults(c, proof).length).toBe(1);
  });
});
