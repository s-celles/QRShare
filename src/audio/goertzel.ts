/**
 * Goertzel tone power at an arbitrary (fractional) frequency (REQ-AUD-055).
 *
 * Returns |Σ x[n]·e^{-jωn}|² over `length` samples starting at `start`, with
 * ω = 2π·freqHz/sampleRate. The power formula is exact for any ω, so tones need
 * not fall on FFT bins, which keeps the modem sample-rate independent (REQ-AUD-056).
 */
export function goertzelPower(
  x: Float32Array,
  start: number,
  length: number,
  freqHz: number,
  sampleRate: number,
): number {
  return goertzelPowerCoeff(x, start, length, 2 * Math.cos((2 * Math.PI * freqHz) / sampleRate));
}

/** Same as `goertzelPower` with a precomputed coefficient `2·cos(ω)`. */
export function goertzelPowerCoeff(x: Float32Array, start: number, length: number, coeff: number): number {
  let s1 = 0;
  let s2 = 0;
  const end = start + length;
  for (let i = start; i < end; i++) {
    const s = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}
