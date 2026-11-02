/**
 * Streaming MFSK demodulator (REQ-AUD-033, REQ-AUD-035, REQ-AUD-055..057).
 *
 * - **Sync**: overlap-save FFT cross-correlation of the input against every armed
 *   profile's chirp, normalised by sqrt(E_window · E_template) so detection does not
 *   depend on input gain. A score ≥ SYNC_THRESHOLD that stays the best within ±½
 *   chirp becomes a `sync` event; the profile with the highest score wins.
 * - **Header / body**: for each symbol the guard is skipped and Goertzel powers of
 *   the 16 tones of every channel are measured over the analysis window. The argmax
 *   gives the nibble; best/second-best power is its confidence. Bytes whose nibbles
 *   fall below ERASURE_RATIO become Reed-Solomon erasures.
 * - **Level**: RMS (dBFS) and peak over every 100 ms of input.
 *
 * Pure TypeScript, no DOM / Web Audio dependency (REQ-AUD-110).
 */

import { chirpEnergy, makeChirp } from "./chirp";
import { fft, ifft, nextPow2 } from "./fft";
import { goertzelPowerCoeff } from "./goertzel";
import { analysisWindow, symbolStartSample } from "./modem";
import { decodeBody, decodeHeader, type PacketDecodeResult } from "./packet";
import {
  HEADER_CODEWORD_BYTES,
  HEADER_PARITY,
  TONES_PER_CHANNEL,
  profilesForSampleRate,
  symbolsForBytes,
  toneHz,
  type AudioProfile,
  type AudioProfileId,
} from "./profiles";

/** Minimum normalised correlation for a preamble. */
export const SYNC_THRESHOLD = 0.45;
/** Nibbles whose best/second tone power ratio is below this are unreliable. */
export const ERASURE_RATIO = 2.0;
const LEVEL_SEC = 0.1;
const SILENCE_DBFS = -120;

export type DemodEvent =
  | { kind: "sync"; profile: AudioProfileId; score: number; atSample: number }
  | { kind: "packet"; result: PacketDecodeResult; profile: AudioProfileId; atSample: number }
  | { kind: "level"; rmsDbfs: number; peak: number };

interface Armed {
  readonly profile: AudioProfile;
  readonly m: number;
  readonly energy: number;
  readonly specRe: Float64Array;
  readonly specIm: Float64Array;
  /** Goertzel coefficient 2cos(ω) per tone, index c·16 + v. */
  readonly coeffs: Float64Array;
  readonly headerSymbols: number;
  readonly scores: Float32Array;
}

interface Candidate {
  pos: number;
  score: number;
  armed: Armed;
}

interface Pending {
  armed: Armed;
  at: number;
  bodyLen?: number;
}

interface SlicedBytes {
  bytes: Uint8Array;
  /** min confidence of the byte's two nibbles */
  confidence: Float64Array;
}

export class StreamingDemodulator {
  readonly sampleRate: number;
  /** Samples of look-ahead the sync stage needs; pushing this much silence flushes it. */
  readonly latencySamples: number;
  private readonly armed: Armed[];
  private readonly fftSize: number;
  private readonly hop: number;
  private readonly xr: Float64Array;
  private readonly xi: Float64Array;
  private readonly yr: Float64Array;
  private readonly yi: Float64Array;
  private readonly prefix: Float64Array;
  private readonly levelN: number;

  private buf = new Float32Array(0);
  private bufStart = 0; // absolute index of buf[0]
  private bufLen = 0;
  private searchPos = 0;
  private cand: Candidate | null = null;
  private pending: Pending | null = null;
  private lvlSum = 0;
  private lvlPeak = 0;
  private lvlCount = 0;

  constructor(sampleRate: number, profiles?: readonly AudioProfile[]) {
    if (!(sampleRate >= 8000)) throw new Error(`Unsupported sample rate ${sampleRate}`);
    this.sampleRate = sampleRate;
    const usable = (profiles ?? profilesForSampleRate(sampleRate)).filter((p) => sampleRate >= p.minSampleRate);
    if (usable.length === 0) throw new Error(`No audio profile supports ${sampleRate} Hz`);

    const templates = usable.map((p) => makeChirp(p, sampleRate));
    const maxM = Math.max(...templates.map((t) => t.length));
    this.fftSize = nextPow2(2 * maxM);
    this.hop = this.fftSize - maxM + 1;
    this.latencySamples = this.fftSize;
    this.xr = new Float64Array(this.fftSize);
    this.xi = new Float64Array(this.fftSize);
    this.yr = new Float64Array(this.fftSize);
    this.yi = new Float64Array(this.fftSize);
    this.prefix = new Float64Array(this.fftSize + 1);
    this.levelN = Math.max(1, Math.round(LEVEL_SEC * sampleRate));

    this.armed = usable.map((profile, i) => {
      const template = templates[i];
      const specRe = new Float64Array(this.fftSize);
      const specIm = new Float64Array(this.fftSize);
      specRe.set(template);
      fft(specRe, specIm);
      const coeffs = new Float64Array(profile.channels * TONES_PER_CHANNEL);
      for (let c = 0; c < profile.channels; c++) {
        for (let v = 0; v < TONES_PER_CHANNEL; v++) {
          coeffs[c * TONES_PER_CHANNEL + v] = 2 * Math.cos((2 * Math.PI * toneHz(profile, c, v)) / sampleRate);
        }
      }
      return {
        profile,
        m: template.length,
        energy: chirpEnergy(template),
        specRe,
        specIm,
        coeffs,
        headerSymbols: symbolsForBytes(profile, HEADER_CODEWORD_BYTES),
        scores: new Float32Array(this.hop),
      };
    });
  }

  /** Profiles this demodulator listens for. */
  get profiles(): AudioProfileId[] {
    return this.armed.map((a) => a.profile.id);
  }

  /** A preamble was detected and its packet is being received (carrier sense). */
  get busy(): boolean {
    return this.pending !== null || this.cand !== null;
  }

  reset(): void {
    this.buf = new Float32Array(0);
    this.bufStart = 0;
    this.bufLen = 0;
    this.searchPos = 0;
    this.cand = null;
    this.pending = null;
    this.lvlSum = 0;
    this.lvlPeak = 0;
    this.lvlCount = 0;
  }

  push(samples: Float32Array): DemodEvent[] {
    const events: DemodEvent[] = [];
    this.measureLevel(samples, events);
    this.append(samples);

    for (;;) {
      if (this.pending) {
        if (!this.decodePending(events)) break;
      } else if (this.bufEnd >= this.searchPos + this.fftSize) {
        this.searchBlock(events);
      } else {
        break;
      }
    }
    this.trim();
    return events;
  }

  // ---------------------------------------------------------------- buffer

  private get bufEnd(): number {
    return this.bufStart + this.bufLen;
  }

  private append(samples: Float32Array): void {
    const needed = this.bufLen + samples.length;
    if (needed > this.buf.length) {
      const next = new Float32Array(Math.max(needed, this.buf.length * 2, this.fftSize * 2));
      next.set(this.buf.subarray(0, this.bufLen));
      this.buf = next;
    }
    this.buf.set(samples, this.bufLen);
    this.bufLen += samples.length;
  }

  private trim(): void {
    let keep = this.searchPos;
    if (this.cand) keep = Math.min(keep, this.cand.pos);
    if (this.pending) keep = Math.min(keep, this.pending.at);
    const drop = Math.min(this.bufLen, Math.max(0, keep - this.bufStart));
    if (drop <= 0) return;
    this.buf.copyWithin(0, drop, this.bufLen);
    this.bufLen -= drop;
    this.bufStart += drop;
  }

  // ----------------------------------------------------------------- level

  private measureLevel(samples: Float32Array, events: DemodEvent[]): void {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      this.lvlSum += v * v;
      const a = v < 0 ? -v : v;
      if (a > this.lvlPeak) this.lvlPeak = a;
      if (++this.lvlCount === this.levelN) {
        const rms = Math.sqrt(this.lvlSum / this.lvlCount);
        events.push({
          kind: "level",
          rmsDbfs: rms > 0 ? Math.max(SILENCE_DBFS, 20 * Math.log10(rms)) : SILENCE_DBFS,
          peak: this.lvlPeak,
        });
        this.lvlSum = 0;
        this.lvlPeak = 0;
        this.lvlCount = 0;
      }
    }
  }

  // ------------------------------------------------------------------ sync

  private searchBlock(events: DemodEvent[]): void {
    const n = this.fftSize;
    const { xr, xi, yr, yi, prefix } = this;
    const off = this.searchPos - this.bufStart;
    prefix[0] = 0;
    for (let i = 0; i < n; i++) {
      const v = this.buf[off + i];
      xr[i] = v;
      xi[i] = 0;
      prefix[i + 1] = prefix[i] + v * v;
    }
    fft(xr, xi);

    for (const a of this.armed) {
      for (let k = 0; k < n; k++) {
        // X · conj(T) → cross-correlation
        yr[k] = xr[k] * a.specRe[k] + xi[k] * a.specIm[k];
        yi[k] = xi[k] * a.specRe[k] - xr[k] * a.specIm[k];
      }
      ifft(yr, yi);
      for (let i = 0; i < this.hop; i++) {
        const ew = prefix[i + a.m] - prefix[i];
        const denom = Math.sqrt(ew * a.energy);
        a.scores[i] = denom > 1e-12 ? yr[i] / denom : 0;
      }
    }

    for (let i = 0; i < this.hop; i++) {
      const pos = this.searchPos + i;
      for (const a of this.armed) {
        const s = a.scores[i];
        if (s >= SYNC_THRESHOLD && (!this.cand || s > this.cand.score)) {
          this.cand = { pos, score: s, armed: a };
        }
      }
      const c = this.cand;
      if (c && pos > c.pos + (c.armed.m >> 1)) {
        events.push({ kind: "sync", profile: c.armed.profile.id, score: c.score, atSample: c.pos });
        this.pending = { armed: c.armed, at: c.pos };
        this.cand = null;
        this.searchPos = c.pos;
        return;
      }
    }
    this.searchPos += this.hop;
  }

  // ------------------------------------------------------------- symbols

  private sliceSymbols(a: Armed, at: number, firstSymbol: number, count: number, bytes: number): SlicedBytes {
    const p = a.profile;
    const nibbles = new Uint8Array(count * p.channels);
    const conf = new Float64Array(count * p.channels);
    for (let s = 0; s < count; s++) {
      const w = analysisWindow(p, this.sampleRate, firstSymbol + s);
      const start = at + w.start - this.bufStart;
      for (let c = 0; c < p.channels; c++) {
        let best = -1;
        let bestP = -1;
        let second = 0;
        for (let v = 0; v < TONES_PER_CHANNEL; v++) {
          const pw = goertzelPowerCoeff(this.buf, start, w.length, a.coeffs[c * TONES_PER_CHANNEL + v]);
          if (pw > bestP) {
            second = bestP;
            bestP = pw;
            best = v;
          } else if (pw > second) {
            second = pw;
          }
        }
        nibbles[s * p.channels + c] = best;
        conf[s * p.channels + c] = second > 0 ? bestP / second : Infinity;
      }
    }
    const out = new Uint8Array(bytes);
    const confidence = new Float64Array(bytes);
    for (let i = 0; i < bytes; i++) {
      out[i] = (nibbles[2 * i] << 4) | nibbles[2 * i + 1];
      confidence[i] = Math.min(conf[2 * i], conf[2 * i + 1]);
    }
    return { bytes: out, confidence };
  }

  /** Erasure sets to try, most informed first. */
  private static erasureAttempts(confidence: Float64Array, parity: number): number[][] {
    const order = Array.from(confidence.keys()).sort((x, y) => confidence[x] - confidence[y]);
    const below = order.filter((i) => confidence[i] < ERASURE_RATIO).slice(0, parity);
    const attempts: number[][] = [below];
    if (below.length > 0) attempts.push([]);
    const lowest = order.slice(0, parity);
    if (lowest.length !== below.length) attempts.push(lowest);
    const half = order.slice(0, parity >> 1);
    if (half.length !== below.length && half.length > 0) attempts.push(half);
    return attempts;
  }

  /** Returns false when more samples are needed. */
  private decodePending(events: DemodEvent[]): boolean {
    const pend = this.pending!;
    const a = pend.armed;
    const p = a.profile;
    const sr = this.sampleRate;

    if (pend.bodyLen === undefined) {
      const hdrEnd = pend.at + symbolStartSample(p, sr, a.headerSymbols);
      if (this.bufEnd < hdrEnd) return false;
      const sliced = this.sliceSymbols(a, pend.at, 0, a.headerSymbols, HEADER_CODEWORD_BYTES);
      let header: ReturnType<typeof decodeHeader> = { ok: false };
      for (const erasures of StreamingDemodulator.erasureAttempts(sliced.confidence, HEADER_PARITY)) {
        header = decodeHeader(sliced.bytes, erasures);
        if (header.ok) break;
      }
      if (!header.ok || header.profile.id !== p.id) {
        events.push({ kind: "packet", result: { kind: "rejected", reason: "header_rs" }, profile: p.id, atSample: pend.at });
        this.pending = null;
        this.searchPos = pend.at + a.m;
        return true;
      }
      pend.bodyLen = header.bodyLen;
    }

    const codewordLen = pend.bodyLen + p.parity;
    const bodySymbols = symbolsForBytes(p, codewordLen);
    const end = pend.at + symbolStartSample(p, sr, a.headerSymbols + bodySymbols);
    if (this.bufEnd < end) return false;

    const sliced = this.sliceSymbols(a, pend.at, a.headerSymbols, bodySymbols, codewordLen);
    let result: PacketDecodeResult = { kind: "rejected", reason: "body_rs" };
    let sawCrc = false;
    for (const erasures of StreamingDemodulator.erasureAttempts(sliced.confidence, p.parity)) {
      result = decodeBody(sliced.bytes, p.parity, erasures);
      if (result.kind === "ok") break;
      if (result.reason === "crc") sawCrc = true;
      // Version / malformed rejections come from a correct CRC: retrying cannot help.
      if (result.reason === "version" || result.reason === "malformed") break;
    }
    if (result.kind === "rejected" && result.reason === "body_rs" && sawCrc) {
      result = { kind: "rejected", reason: "crc" };
    }
    events.push({ kind: "packet", result, profile: p.id, atSample: pend.at });
    this.pending = null;
    // After a rejection, search again right after this preamble: the sync may have been
    // false, or the packet cut short, and a real preamble may start inside its span.
    this.searchPos = result.kind === "ok" ? end : pend.at + a.m;
    return true;
  }
}
