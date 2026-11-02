/**
 * Linear chirp preambles (REQ-AUD-053). Each profile has its own sweep
 * (Robust: up 1.5→6.3 kHz; Fast: down 6.3→1.5 kHz; Ultrasonic: up 18.5→19.8 kHz),
 * so the receiver detects the profile from the preamble alone (REQ-AUD-035).
 */

import type { AudioProfile } from "./profiles";

/** Fraction of the chirp tapered by a Hann half-window at each end. */
const TAPER_FRACTION = 0.15;

const cache = new Map<string, Float32Array>();

/** Hann-tapered linear chirp of `round(duration·sampleRate)` samples. */
export function makeChirp(profile: AudioProfile, sampleRate: number): Float32Array {
  const key = `${profile.id}@${sampleRate}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { f0, f1, durationSec } = profile.chirp;
  const n = Math.round(durationSec * sampleRate);
  const taper = Math.max(1, Math.round(n * TAPER_FRACTION));
  const k = (f1 - f0) / durationSec; // sweep rate (Hz/s)
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * k * t * t);
    let w = 1;
    if (i < taper) w = 0.5 * (1 - Math.cos((Math.PI * i) / taper));
    else if (i >= n - taper) w = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - i)) / taper));
    out[i] = profile.peak * w * Math.sin(phase);
  }
  cache.set(key, out);
  return out;
}

export function chirpEnergy(template: Float32Array): number {
  let e = 0;
  for (let i = 0; i < template.length; i++) e += template[i] * template[i];
  return e;
}
