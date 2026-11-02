/**
 * MFSK modulator (REQ-AUD-050..054, REQ-AUD-056).
 *
 * On-air packet = chirp ‖ 10 ms silence ‖ header symbols ‖ body symbols ‖ gap.
 * Each symbol carries `channels` simultaneous tones; each tone picks one of 16
 * frequencies in its channel's sub-band (one nibble). Symbol i starts at
 * round((t0 + i·T_sym)·sampleRate), so timing never drifts whatever the rate.
 */

import { makeChirp } from "./chirp";
import {
  HEADER_CODEWORD_BYTES,
  PREAMBLE_GAP_SEC,
  symbolSec,
  symbolsForBytes,
  toneHz,
  type AudioProfile,
} from "./profiles";

/** Total peak amplitude budget shared by the simultaneous tones. */
export const TONE_PEAK = 0.9;

export function bytesToNibbles(bytes: Uint8Array): number[] {
  const out: number[] = new Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = bytes[i] >> 4;
    out[2 * i + 1] = bytes[i] & 0x0f;
  }
  return out;
}

export function nibblesToBytes(nibbles: readonly number[]): Uint8Array {
  const out = new Uint8Array(Math.floor(nibbles.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = ((nibbles[2 * i] & 0x0f) << 4) | (nibbles[2 * i + 1] & 0x0f);
  return out;
}

/** Groups nibbles into symbols of `channels` nibbles, padding the last with 0. */
export function nibblesToSymbols(nibbles: readonly number[], channels: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < nibbles.length; i += channels) {
    const sym = new Array<number>(channels).fill(0);
    for (let c = 0; c < channels && i + c < nibbles.length; c++) sym[c] = nibbles[i + c];
    out.push(sym);
  }
  return out;
}

/** Offset (seconds) of the first header symbol from the start of the chirp. */
export function firstSymbolSec(p: AudioProfile): number {
  return p.chirp.durationSec + PREAMBLE_GAP_SEC;
}

/** Sample index (from the chirp start) where symbol `i` begins. */
export function symbolStartSample(p: AudioProfile, sampleRate: number, i: number): number {
  return Math.round((firstSymbolSec(p) + i * symbolSec(p)) * sampleRate);
}

/**
 * Analysis window of symbol `i` (sample offsets from the chirp start): the guard is
 * skipped and the window is clamped so it never reads into the next symbol, whatever
 * the rounding at this sample rate.
 */
export function analysisWindow(p: AudioProfile, sampleRate: number, i: number): { start: number; length: number } {
  const symStart = symbolStartSample(p, sampleRate, i);
  const next = symbolStartSample(p, sampleRate, i + 1);
  const start = symStart + Math.round(p.guardSec * sampleRate);
  return { start, length: Math.max(1, Math.min(Math.round(p.windowSec * sampleRate), next - start)) };
}

/** Total samples of a packet with `symbols` symbols, including the trailing gap. */
export function packetSampleCount(p: AudioProfile, sampleRate: number, symbols: number): number {
  return Math.round((firstSymbolSec(p) + symbols * symbolSec(p) + p.gapSec) * sampleRate);
}

/** Symbols of a header codeword followed by a body codeword. */
export function packetSymbols(p: AudioProfile, onAir: Uint8Array): number[][] {
  const header = nibblesToSymbols(bytesToNibbles(onAir.subarray(0, HEADER_CODEWORD_BYTES)), p.channels);
  const body = nibblesToSymbols(bytesToNibbles(onAir.subarray(HEADER_CODEWORD_BYTES)), p.channels);
  return [...header, ...body];
}

/**
 * Pure modulator: on-air bytes (7-byte header codeword ‖ body codeword) →
 * mono samples in [-0.9, 0.9].
 */
export function modulate(onAir: Uint8Array, p: AudioProfile, sampleRate: number): Float32Array {
  if (onAir.length <= HEADER_CODEWORD_BYTES) throw new Error("modulate: packet too short");
  const symbols = packetSymbols(p, onAir);
  const expected = symbolsForBytes(p, HEADER_CODEWORD_BYTES) + symbolsForBytes(p, onAir.length - HEADER_CODEWORD_BYTES);
  if (symbols.length !== expected) throw new Error("modulate: symbol count mismatch");

  const out = new Float32Array(packetSampleCount(p, sampleRate, symbols.length));
  out.set(makeChirp(p, sampleRate), 0);

  const amp = TONE_PEAK / p.channels;
  const rampN = Math.max(1, Math.round(p.rampSec * sampleRate));
  const omegas = new Float64Array(p.channels);
  const phases = new Float64Array(p.channels);
  for (let i = 0; i < symbols.length; i++) {
    const start = symbolStartSample(p, sampleRate, i);
    const end = symbolStartSample(p, sampleRate, i + 1);
    const len = end - start;
    for (let c = 0; c < p.channels; c++) {
      omegas[c] = (2 * Math.PI * toneHz(p, c, symbols[i][c])) / sampleRate;
      phases[c] = (c * Math.PI) / 3; // fixed per-channel phase lowers the crest factor
    }
    for (let n = 0; n < len; n++) {
      let s = 0;
      for (let c = 0; c < p.channels; c++) s += Math.sin(omegas[c] * n + phases[c]);
      let w = 1;
      if (n < rampN) w = 0.5 * (1 - Math.cos((Math.PI * n) / rampN));
      else if (n >= len - rampN) w = 0.5 * (1 - Math.cos((Math.PI * (len - 1 - n)) / rampN));
      out[start + n] = amp * w * s;
    }
  }
  return out;
}
