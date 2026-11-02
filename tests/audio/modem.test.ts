import { describe, expect, it } from "bun:test";
import { makeChirp, CHIRP_AMPLITUDE } from "@/audio/chirp";
import {
  bytesToNibbles,
  nibblesToBytes,
  nibblesToSymbols,
  modulate,
  packetSampleCount,
  symbolStartSample,
} from "@/audio/modem";
import { AUDIO_PROFILES, getProfile, HEADER_CODEWORD_BYTES, symbolsForBytes, toneHz } from "@/audio/profiles";
import { encodeDataBody, encodeOnAir } from "@/audio/packet";
import { goertzelPower } from "@/audio/goertzel";
import { randomBytes } from "./helpers";

function maxNormXcorr(a: Float32Array, b: Float32Array): number {
  // Sliding normalised cross-correlation of b against a (all lags), brute force.
  let ea = 0;
  let eb = 0;
  for (const v of a) ea += v * v;
  for (const v of b) eb += v * v;
  const norm = Math.sqrt(ea * eb);
  let best = 0;
  for (let lag = -b.length + 1; lag < a.length; lag += 2) {
    let s = 0;
    for (let m = 0; m < b.length; m++) {
      const i = lag + m;
      if (i >= 0 && i < a.length) s += a[i] * b[m];
    }
    best = Math.max(best, Math.abs(s) / norm);
  }
  return best;
}

describe("chirp preambles (REQ-AUD-053)", () => {
  it("has length round(d·sr) and is Hann-tapered at both ends", () => {
    for (const sr of [22050, 44100, 48000]) {
      for (const p of AUDIO_PROFILES.filter((x) => sr >= x.minSampleRate)) {
        const c = makeChirp(p, sr);
        expect(c.length).toBe(Math.round(p.chirp.durationSec * sr));
        expect(Math.abs(c[0])).toBeLessThan(1e-6);
        expect(Math.abs(c[c.length - 1])).toBeLessThan(0.01);
        let peak = 0;
        for (const v of c) peak = Math.max(peak, Math.abs(v));
        expect(peak).toBeLessThanOrEqual(CHIRP_AMPLITUDE + 1e-6);
        expect(peak).toBeGreaterThan(0.8 * CHIRP_AMPLITUDE);
      }
    }
  });

  it("sweeps up for robust/ultrasonic and down for fast", () => {
    const sr = 48000;
    const energyAt = (x: Float32Array, start: number, f: number) => goertzelPower(x, start, 480, f, sr);
    const robust = makeChirp(getProfile("robust"), sr);
    expect(energyAt(robust, 400, 1800)).toBeGreaterThan(energyAt(robust, 400, 6000));
    expect(energyAt(robust, robust.length - 900, 6000)).toBeGreaterThan(energyAt(robust, robust.length - 900, 1800));
    const fast = makeChirp(getProfile("fast"), sr);
    expect(energyAt(fast, 300, 6000)).toBeGreaterThan(energyAt(fast, 300, 1800));
  });

  it("distinct templates have a low cross-correlation (< 0.2)", () => {
    const sr = 44100;
    const chirps = AUDIO_PROFILES.map((p) => makeChirp(p, sr));
    for (let i = 0; i < chirps.length; i++) {
      for (let j = 0; j < chirps.length; j++) {
        if (i === j) continue;
        expect(maxNormXcorr(chirps[i], chirps[j])).toBeLessThan(0.2);
      }
    }
  });
});

describe("nibble mapping (REQ-AUD-050)", () => {
  it("maps bytes to nibbles high nibble first and back", () => {
    expect(bytesToNibbles(new Uint8Array([0xab, 0x01]))).toEqual([0xa, 0xb, 0x0, 0x1]);
    expect(nibblesToBytes([0xa, 0xb, 0x0, 0x1])).toEqual(new Uint8Array([0xab, 0x01]));
  });

  it("fills channels in order and pads the last symbol with 0", () => {
    expect(nibblesToSymbols([1, 2, 3, 4, 5, 6, 7], 6)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 0, 0, 0, 0, 0],
    ]);
  });
});

describe("modulate (REQ-AUD-050, 052, 054, 056)", () => {
  const body = encodeDataBody(new Uint8Array([9, 9, 9, 9]), 3, randomBytes(48, 8));

  it("produces the expected sample count at several rates", () => {
    for (const sr of [22050, 44100, 48000, 96000]) {
      for (const p of AUDIO_PROFILES.filter((x) => sr >= x.minSampleRate)) {
        const air = encodeOnAir(body, p);
        const x = modulate(air, p, sr);
        const symbols = symbolsForBytes(p, HEADER_CODEWORD_BYTES) + symbolsForBytes(p, air.length - HEADER_CODEWORD_BYTES);
        expect(x.length).toBe(packetSampleCount(p, sr, symbols));
        const sec = p.chirp.durationSec + 0.01 + symbols * (p.guardSec + p.windowSec) + p.gapSec;
        expect(Math.abs(x.length - sec * sr)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the peak amplitude at or below 0.9", () => {
    for (const p of AUDIO_PROFILES) {
      const x = modulate(encodeOnAir(body, p), p, 48000);
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThanOrEqual(0.9);
    }
  });

  it("ramps symbol edges (no clicks) and is deterministic", () => {
    const p = getProfile("robust");
    const sr = 48000;
    const air = encodeOnAir(body, p);
    const a = modulate(air, p, sr);
    const b = modulate(air, p, sr);
    expect(a).toEqual(b);
    // First sample of the first header symbol is ~0 thanks to the ramp.
    const s0 = symbolStartSample(p, sr, 0);
    expect(Math.abs(a[s0])).toBeLessThan(1e-6);
    // Just before the next symbol starts, the ramp has brought the level near zero.
    const s1 = symbolStartSample(p, sr, 1);
    expect(Math.abs(a[s1 - 1])).toBeLessThan(0.05);
  });

  it("puts the strongest tone of each channel on the encoded nibble", () => {
    const p = getProfile("fast");
    const sr = 44100;
    const air = encodeOnAir(body, p);
    const x = modulate(air, p, sr);
    const nibbles = bytesToNibbles(air.subarray(0, HEADER_CODEWORD_BYTES));
    const start = symbolStartSample(p, sr, 0) + Math.round(p.guardSec * sr);
    const n = Math.round(p.windowSec * sr);
    for (let c = 0; c < p.channels; c++) {
      let best = -1;
      let bestP = -1;
      for (let v = 0; v < 16; v++) {
        const pw = goertzelPower(x, start, n, toneHz(p, c, v), sr);
        if (pw > bestP) {
          bestP = pw;
          best = v;
        }
      }
      expect(best).toBe(nibbles[c]);
    }
  });
});
