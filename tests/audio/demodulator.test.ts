import { describe, expect, it } from "bun:test";
import { StreamingDemodulator, type DemodEvent } from "@/audio/demodulator";
import { analysisWindow, modulate, symbolStartSample } from "@/audio/modem";
import { encodeDataBody, encodeOnAir, type PacketDecodeResult } from "@/audio/packet";
import { AUDIO_PROFILES, getProfile, topToneHz, type AudioProfile } from "@/audio/profiles";
import {
  awgn,
  concat,
  convolve,
  gain,
  noise,
  offset,
  prng,
  randomBytes,
  randomChunks,
  resampleLinear,
  reverbIr,
  silence,
} from "./helpers";

const HASH = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

/** A train of `count` data packets with ids 1..count. */
function packetTrain(p: AudioProfile, sr: number, count: number, seed = 1): { audio: Float32Array; symbols: Uint8Array[] } {
  const parts: Float32Array[] = [];
  const symbols: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const sym = randomBytes(p.blockSize, seed * 1000 + i);
    symbols.push(sym);
    parts.push(modulate(encodeOnAir(encodeDataBody(HASH, i + 1, sym), p), p, sr));
  }
  return { audio: concat(...parts), symbols };
}

function run(demod: StreamingDemodulator, audio: Float32Array, chunks?: Float32Array[]): DemodEvent[] {
  const events: DemodEvent[] = [];
  for (const c of chunks ?? [audio]) events.push(...demod.push(c));
  // Flush with trailing silence so the last packet's preamble block completes.
  events.push(...demod.push(new Float32Array(demod.latencySamples)));
  return events;
}

function okPackets(events: DemodEvent[]): PacketDecodeResult[] {
  return events.filter((e): e is Extract<DemodEvent, { kind: "packet" }> => e.kind === "packet").map((e) => e.result)
    .filter((r) => r.kind === "ok");
}

function countCorrect(events: DemodEvent[], symbols: Uint8Array[]): number {
  let correct = 0;
  for (const r of okPackets(events)) {
    if (r.kind !== "ok" || r.packet.kind !== "data") continue;
    const want = symbols[r.packet.symbolId - 1];
    if (want && want.every((v, i) => (r.packet.kind === "data" ? r.packet.symbol[i] === v : false))) correct++;
  }
  return correct;
}

function band(p: AudioProfile): [number, number] {
  return [Math.min(p.baseHz, p.chirp.f0, p.chirp.f1), Math.max(topToneHz(p), p.chirp.f0, p.chirp.f1)];
}

describe("StreamingDemodulator sync (REQ-AUD-035, 055)", () => {
  it("detects each profile's chirp at the right offset across gains 0.01–1.0", () => {
    const sr = 48000;
    for (const p of AUDIO_PROFILES) {
      for (const g of [0.01, 0.1, 1.0]) {
        const lead = 1234 + Math.round(g * 1000);
        const { audio } = packetTrain(p, sr, 1);
        const demod = new StreamingDemodulator(sr);
        const events = run(demod, offset(gain(audio, g), lead));
        const syncs = events.filter((e) => e.kind === "sync");
        expect(syncs.length).toBe(1);
        const s = syncs[0];
        if (s.kind !== "sync") throw new Error();
        expect(s.profile).toBe(p.id);
        expect(Math.abs(s.atSample - lead)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("does not sync on 60 s of seeded white noise", () => {
    const sr = 22050;
    const demod = new StreamingDemodulator(sr);
    const events = run(demod, noise(60, sr, 0.1, 42));
    expect(events.filter((e) => e.kind === "sync").length).toBe(0);
  });

  it("does not sync on 20 s of seeded noise at 48 kHz (all three profiles armed)", () => {
    const sr = 48000;
    const demod = new StreamingDemodulator(sr);
    const events = run(demod, noise(20, sr, 0.2, 43));
    expect(events.filter((e) => e.kind === "sync").length).toBe(0);
  });
});

describe("StreamingDemodulator clean loopback (REQ-AUD-057, 111)", () => {
  for (const sr of [44100, 48000]) {
    for (const p of AUDIO_PROFILES) {
      it(`${p.id} @ ${sr} Hz is byte-exact`, () => {
        const { audio, symbols } = packetTrain(p, sr, 4, 2);
        const demod = new StreamingDemodulator(sr);
        const events = run(demod, offset(audio, 777));
        expect(countCorrect(events, symbols)).toBe(4);
        const res = okPackets(events)[0];
        if (res.kind === "ok") expect(res.correctedBytes).toBe(0);
      });
    }
  }

  it("works at 22.05 kHz and 96 kHz for the audible profiles", () => {
    for (const sr of [22050, 96000]) {
      for (const p of [getProfile("robust"), getProfile("fast")]) {
        const { audio, symbols } = packetTrain(p, sr, 2, 3);
        expect(countCorrect(run(new StreamingDemodulator(sr), audio), symbols)).toBe(2);
      }
    }
  });
});

describe("StreamingDemodulator robustness (REQ-AUD-112)", () => {
  const sr = 48000;

  function acceptance(p: AudioProfile, transform: (x: Float32Array) => Float32Array, count = 20, rxRate = sr, seed = 9) {
    const { audio, symbols } = packetTrain(p, sr, count, seed);
    const rx = transform(concat(silence(0.3, sr), audio, silence(0.3, sr)));
    const demod = new StreamingDemodulator(rxRate);
    const events = run(demod, rx);
    return countCorrect(events, symbols) / count;
  }

  it("Robust survives AWGN at 6 dB in-band SNR (≥ 95%)", () => {
    const p = getProfile("robust");
    const rate = acceptance(p, (x) => awgn(x, 6, band(p), sr, 101));
    console.log(`[measure] robust AWGN 6 dB: ${(rate * 100).toFixed(0)}% packets accepted`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it("Fast survives AWGN at 12 dB in-band SNR (≥ 95%)", () => {
    const p = getProfile("fast");
    const rate = acceptance(p, (x) => awgn(x, 12, band(p), sr, 102));
    console.log(`[measure] fast AWGN 12 dB: ${(rate * 100).toFixed(0)}% packets accepted`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it("survives gains from 0.01 to 1.0", () => {
    for (const g of [0.01, 0.05, 0.3, 1.0]) {
      expect(acceptance(getProfile("robust"), (x) => gain(x, g), 5)).toBe(1);
    }
  });

  it("Robust survives a simulated reverb (40 ms decay) (≥ 95%)", () => {
    const p = getProfile("robust");
    const ir = reverbIr(0.04, sr);
    const rate = acceptance(p, (x) => convolve(x, ir));
    console.log(`[measure] robust reverb 40 ms: ${(rate * 100).toFixed(0)}% packets accepted`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it("Fast survives the same reverb (≥ 95%)", () => {
    const p = getProfile("fast");
    const ir = reverbIr(0.04, sr);
    const rate = acceptance(p, (x) => convolve(x, ir));
    console.log(`[measure] fast reverb 40 ms: ${(rate * 100).toFixed(0)}% packets accepted`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it("interoperates 48 kHz sender → 44.1 kHz receiver (every profile)", () => {
    for (const p of AUDIO_PROFILES) {
      const rate = acceptance(p, (x) => resampleLinear(x, 48000, 44100), 10, 44100);
      expect(rate).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("is insensitive to chunk sizes (1–5000 samples)", () => {
    const p = getProfile("fast");
    const { audio, symbols } = packetTrain(p, sr, 6, 4);
    const demod = new StreamingDemodulator(sr);
    const events = run(demod, audio, randomChunks(audio, 5000, 17));
    expect(countCorrect(events, symbols)).toBe(6);
  });

  it("reports rejected packets instead of throwing on heavy corruption", () => {
    const p = getProfile("fast");
    const { audio } = packetTrain(p, sr, 5, 6);
    const r = prng(3);
    const corrupted = new Float32Array(audio);
    // Burst noise over the second half of every packet.
    for (let i = 0; i < corrupted.length; i++) if ((i % 51360) > 30000) corrupted[i] += (r() - 0.5) * 2;
    const events = run(new StreamingDemodulator(sr), corrupted);
    const packets = events.filter((e) => e.kind === "packet");
    expect(packets.length).toBeGreaterThan(0);
  });
});

describe("level events (REQ-AUD-033)", () => {
  it("emits RMS dBFS and peak at most every 100 ms", () => {
    const sr = 48000;
    const x = new Float32Array(sr);
    for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const demod = new StreamingDemodulator(sr);
    const levels = demod.push(x).filter((e) => e.kind === "level");
    expect(levels.length).toBe(10);
    const l = levels[5];
    if (l.kind !== "level") throw new Error();
    expect(l.rmsDbfs).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(l.peak).toBeCloseTo(0.5, 2);
  });

  it("reports silence as a very low level", () => {
    const demod = new StreamingDemodulator(44100);
    const levels = demod.push(new Float32Array(4410)).filter((e) => e.kind === "level");
    expect(levels.length).toBe(1);
    if (levels[0].kind === "level") expect(levels[0].rmsDbfs).toBeLessThanOrEqual(-100);
  });
});

describe("performance (REQ-AUD-093)", () => {
  it("demodulates 10 s of Fast audio in under 1 s", () => {
    const sr = 48000;
    const p = getProfile("fast");
    const { audio } = packetTrain(p, sr, 10, 5);
    const ten = concat(audio, silence(Math.max(0, 10 - audio.length / sr), sr));
    const chunks: Float32Array[] = [];
    for (let i = 0; i < ten.length; i += 2048) chunks.push(ten.subarray(i, i + 2048));
    const demod = new StreamingDemodulator(sr);
    const t0 = performance.now();
    for (const c of chunks) demod.push(c);
    const ms = performance.now() - t0;
    console.log(`[measure] 10 s of Fast audio @48 kHz demodulated in ${ms.toFixed(0)} ms (${(ms / 10).toFixed(1)} ms per audio second)`);
    expect(ms).toBeLessThan(1000);
  });
});

describe("review fixes (items 7, 8)", () => {
  it("analysis windows never extend past their symbol, at any sample rate", () => {
    for (const p of AUDIO_PROFILES) {
      for (let sr = 22050; sr <= 96000; sr += 977) {
        if (sr < p.minSampleRate) continue;
        for (let i = 0; i < 60; i++) {
          const w = analysisWindow(p, sr, i);
          expect(w.start).toBeGreaterThanOrEqual(symbolStartSample(p, sr, i));
          expect(w.start + w.length).toBeLessThanOrEqual(symbolStartSample(p, sr, i + 1));
          expect(w.length).toBeGreaterThanOrEqual(Math.round(p.windowSec * sr) - 1);
        }
      }
    }
  });

  it("resumes the search inside a rejected packet's span (a cut-off packet does not hide the next one)", () => {
    const sr = 48000;
    const p = getProfile("fast");
    const { audio: first } = packetTrain(p, sr, 1, 70);
    const { audio: rest, symbols } = packetTrain(p, sr, 3, 71);
    // The first packet is cut 40% into its body: its header decodes, its body cannot.
    const cut = first.subarray(0, Math.round(first.length * 0.45));
    const events = run(new StreamingDemodulator(sr), concat(cut, rest));
    const rejected = events.filter((e) => e.kind === "packet" && e.result.kind === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(countCorrect(events, symbols)).toBe(3);
  });
});
