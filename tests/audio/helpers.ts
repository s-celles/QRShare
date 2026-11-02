import { fft, ifft } from "@/audio/fft";

/**
 * Deterministic signal helpers for the audio loopback tests (REQ-AUD-112).
 * Everything is seeded so that test runs are reproducible.
 */

/** mulberry32: small seeded PRNG returning floats in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples (Box–Muller) from a seeded PRNG. */
export function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export function randomBytes(n: number, seed: number): Uint8Array {
  const r = prng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(r() * 256);
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function silence(sec: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(sec * sampleRate));
}

export function gain(samples: Float32Array, g: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** Prepends `n` samples of low-level noise (a random leading offset). */
export function offset(samples: Float32Array, n: number, seed = 1): Float32Array {
  const g = gaussian(prng(seed));
  const lead = new Float32Array(n);
  for (let i = 0; i < n; i++) lead[i] = g() * 1e-4;
  return concat(lead, samples);
}

/** Mean power of the non-silent part of a signal. */
export function activePower(samples: Float32Array): number {
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    if (s !== 0) {
      sum += s * s;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Adds white Gaussian noise so that the SNR measured *in band*
 * (`band` = [lowHz, highHz]) is `snrDb`. The signal power is the mean power of the
 * non-silent samples; white noise spreads its power evenly over 0..sr/2, so the
 * full-band noise power is scaled by (sr/2) / bandwidth.
 */
export function awgn(
  samples: Float32Array,
  snrDb: number,
  band: readonly [number, number],
  sampleRate: number,
  seed = 7,
): Float32Array {
  const sigPower = activePower(samples);
  const inBandNoise = sigPower / 10 ** (snrDb / 10);
  const fullBandNoise = inBandNoise * (sampleRate / 2) / (band[1] - band[0]);
  const sigma = Math.sqrt(fullBandNoise);
  const g = gaussian(prng(seed));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] + g() * sigma;
  return out;
}

/** Pure white noise at the given RMS level. */
export function noise(sec: number, sampleRate: number, rms: number, seed = 3): Float32Array {
  const g = gaussian(prng(seed));
  const out = new Float32Array(Math.round(sec * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = g() * rms;
  return out;
}

/**
 * Simulated room: the direct path plus a dense, exponentially decaying random tail
 * whose amplitude envelope is exp(-t / tau) with tau = decaySec, starting 1 ms after
 * the direct path, at `tailGain` relative level. The impulse response is truncated
 * at 5·tau.
 */
export function reverbIr(
  decaySec: number,
  sampleRate: number,
  tailGain = 0.5,
  seed = 11,
): Float32Array {
  const len = Math.round(5 * decaySec * sampleRate);
  const ir = new Float32Array(len);
  ir[0] = 1;
  const g = gaussian(prng(seed));
  const start = Math.round(0.001 * sampleRate);
  // Normalise so that the tail energy is tailGain² of the direct path energy.
  let energy = 0;
  for (let n = start; n < len; n++) {
    const v = g() * Math.exp(-(n - start) / (decaySec * sampleRate));
    ir[n] = v;
    energy += v * v;
  }
  const scale = tailGain / Math.sqrt(energy);
  for (let n = start; n < len; n++) ir[n] *= scale;
  return ir;
}

/** Linear convolution through the FFT (fast enough for multi-second signals). */
export function convolve(x: Float32Array, ir: Float32Array): Float32Array {
  const outLen = x.length + ir.length - 1;
  let n = 1;
  while (n < outLen) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(x);
  br.set(ir);
  fft(ar, ai);
  fft(br, bi);
  for (let k = 0; k < n; k++) {
    const re = ar[k] * br[k] - ai[k] * bi[k];
    const im = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = re;
    ai[k] = im;
  }
  ifft(ar, ai);
  const out = new Float32Array(outLen);
  for (let k = 0; k < outLen; k++) out[k] = ar[k];
  return out;
}

/** Linear-interpolation resampler (e.g. 48 kHz → 44.1 kHz). */
export function resampleLinear(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const n = Math.floor((x.length - 1) / ratio) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = x[i0];
    const b = i0 + 1 < x.length ? x[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Splits samples into random-size chunks (1..maxChunk), as a capture node might deliver. */
export function randomChunks(x: Float32Array, maxChunk: number, seed = 5): Float32Array[] {
  const r = prng(seed);
  const out: Float32Array[] = [];
  let i = 0;
  while (i < x.length) {
    const len = 1 + Math.floor(r() * maxChunk);
    out.push(x.subarray(i, Math.min(x.length, i + len)));
    i += len;
  }
  return out;
}
