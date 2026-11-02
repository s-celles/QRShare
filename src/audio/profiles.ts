/**
 * Physical-layer profiles of the audio modem (REQ-AUD-051), size limits
 * (REQ-AUD-002, REQ-AUD-004) and airtime estimates shared by the UI and docs.
 *
 * Every profile uses 16 tones per channel in contiguous sub-bands:
 * channel c, nibble v → f = baseHz + (c·16 + v)·toneSpacingHz.
 */

export type AudioProfileId = "robust" | "fast" | "ultrasonic";

export interface AudioProfile {
  readonly id: AudioProfileId;
  /** Frequency of tone 0 of channel 0. */
  readonly baseHz: number;
  /** Spacing between adjacent tones. */
  readonly toneSpacingHz: number;
  /** Simultaneous tones per symbol (4 bits each). */
  readonly channels: number;
  /** Analysis window (Goertzel length). */
  readonly windowSec: number;
  /** Leading guard (echo absorption), not analysed. */
  readonly guardSec: number;
  /** Raised-cosine ramp at each symbol edge. */
  readonly rampSec: number;
  /** Preamble chirp; f0 > f1 means a down-chirp. */
  readonly chirp: { readonly f0: number; readonly f1: number; readonly durationSec: number };
  /** Silence after each packet (reverb tail). */
  readonly gapSec: number;
  /** Default fountain symbol size (bytes). */
  readonly blockSize: number;
  /** Reed-Solomon parity bytes of the body codeword. */
  readonly parity: number;
  readonly minSampleRate: number;
  readonly lessReliable: boolean;
  /**
   * Peak amplitude of the packet (chirp and summed tones). Ultrasonic plays at half
   * level: loudspeaker distortion turns near-ultrasonic tones into audible sound, and
   * halving the level removes about 6 dB of it.
   */
  readonly peak: number;
}

export const TONES_PER_CHANNEL = 16;
/** Silence between the chirp and the first header symbol. */
export const PREAMBLE_GAP_SEC = 0.01;
/** On-air header codeword: RS(7,3). */
export const HEADER_DATA_BYTES = 3;
export const HEADER_PARITY = 4;
export const HEADER_CODEWORD_BYTES = HEADER_DATA_BYTES + HEADER_PARITY;
/** Data body: type/version (1) + metadataHash (4) + symbolId (2) + symbol + CRC32 (4). */
export const DATA_BODY_OVERHEAD = 11;
/** Metadata body: type/version (1) + v3 frame header (57 + filename) + CRC32 (4). */
export const METADATA_BODY_OVERHEAD = 62;

/** Hard maximum raw payload size for audio (Q4: 8 KiB). */
export const AUDIO_MAX_BYTES = 8 * 1024;
/** Payloads up to this size are described as suitable for audio. */
export const AUDIO_SUGGESTED_MAX_BYTES = 1024;
/** One metadata packet is sent first, then after every META_INTERVAL data packets. */
export const META_INTERVAL = 8;

export const AUDIO_PROFILES: readonly AudioProfile[] = [
  {
    id: "robust",
    baseHz: 1500,
    toneSpacingHz: 50,
    channels: 6,
    windowSec: 0.04,
    guardSec: 0.02,
    rampSec: 0.004,
    chirp: { f0: 1500, f1: 6300, durationSec: 0.1 },
    gapSec: 0.08,
    blockSize: 48,
    parity: 16,
    minSampleRate: 22050,
    lessReliable: false,
    peak: 0.9,
  },
  {
    id: "fast",
    baseHz: 1500,
    toneSpacingHz: 50,
    channels: 6,
    windowSec: 0.02,
    guardSec: 0.01,
    rampSec: 0.002,
    chirp: { f0: 6300, f1: 1500, durationSec: 0.06 },
    gapSec: 0.04,
    blockSize: 64,
    parity: 12,
    minSampleRate: 22050,
    lessReliable: false,
    peak: 0.9,
  },
  {
    // 18.5–19.74 kHz, 2 tones at a time, half level: fewer adults hear this band, and
    // fewer simultaneous tones at a lower level produce less audible distortion.
    id: "ultrasonic",
    baseHz: 18500,
    toneSpacingHz: 40,
    channels: 2,
    windowSec: 0.05,
    guardSec: 0.025,
    rampSec: 0.005,
    chirp: { f0: 18500, f1: 19800, durationSec: 0.1 },
    gapSec: 0.08,
    blockSize: 32,
    parity: 16,
    minSampleRate: 44100,
    lessReliable: true,
    peak: 0.45,
  },
];

export const DEFAULT_PROFILE_ID: AudioProfileId = "robust";

export function getProfile(id: AudioProfileId): AudioProfile {
  const p = AUDIO_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown audio profile ${id}`);
  return p;
}

export function profileIndex(id: AudioProfileId): number {
  return AUDIO_PROFILES.findIndex((p) => p.id === id);
}

export function profileByIndex(index: number): AudioProfile | undefined {
  return AUDIO_PROFILES[index];
}

/** Profiles usable at a given sample rate (band below Nyquist). */
export function profilesForSampleRate(sampleRate: number): AudioProfile[] {
  return AUDIO_PROFILES.filter((p) => sampleRate >= p.minSampleRate);
}

export function toneHz(p: AudioProfile, channel: number, nibble: number): number {
  return p.baseHz + (channel * TONES_PER_CHANNEL + nibble) * p.toneSpacingHz;
}

export function topToneHz(p: AudioProfile): number {
  return toneHz(p, p.channels - 1, TONES_PER_CHANNEL - 1);
}

export function symbolSec(p: AudioProfile): number {
  return p.guardSec + p.windowSec;
}

/** Number of MFSK symbols needed to carry `bytes` bytes (two nibbles per byte). */
export function symbolsForBytes(p: AudioProfile, bytes: number): number {
  return Math.ceil((2 * bytes) / p.channels);
}

export function dataBodyLen(blockSize: number): number {
  return DATA_BODY_OVERHEAD + blockSize;
}

export function metadataBodyLen(filenameBytes: number): number {
  return METADATA_BODY_OVERHEAD + filenameBytes;
}

/** Airtime of one packet whose body (including CRC, excluding parity) is `bodyLen` bytes. */
export function packetDurationSec(p: AudioProfile, bodyLen: number): number {
  const symbols = symbolsForBytes(p, HEADER_CODEWORD_BYTES) + symbolsForBytes(p, bodyLen + p.parity);
  return p.chirp.durationSec + PREAMBLE_GAP_SEC + symbols * symbolSec(p) + p.gapSec;
}

/**
 * Fountain block size for a compressed payload of `dataLen` bytes: the profile's
 * block size, shrunk so that K ≥ 2 (same rule as `encode-worker.ts`, REQ-AUD-077).
 */
export function effectiveBlockSize(profileBlockSize: number, dataLen: number): number {
  let blockSize = profileBlockSize;
  if (dataLen > 0 && dataLen < blockSize * 2) blockSize = Math.max(1, Math.floor(dataLen / 2));
  return blockSize;
}

/**
 * Net payload bytes per second of airtime: data packets plus one metadata packet
 * per META_INTERVAL data packets (filename defaults to `message.txt`, 11 bytes).
 */
export function estimateNetBytesPerSecond(p: AudioProfile, filenameBytes = 11): number {
  const tData = packetDurationSec(p, dataBodyLen(p.blockSize));
  const tMeta = packetDurationSec(p, metadataBodyLen(filenameBytes));
  return (META_INTERVAL * p.blockSize) / (META_INTERVAL * tData + tMeta);
}

/** Fountain symbols needed to decode K source blocks, by codec (approximate). */
export function symbolsNeeded(k: number, codec: "wirehair" | "lt"): number {
  // Wirehair needs about K + 0.02 symbols; LT (robust soliton) at small K needs tens of percent more.
  // With K = 1 every LT symbol is the source block itself.
  if (k <= 1) return k;
  return codec === "wirehair" ? k : Math.ceil(k * 1.25) + 2;
}

/**
 * Estimated minimum airtime (seconds) to deliver a payload of `size` bytes
 * (the compressed size when known, otherwise the raw size as an upper bound).
 */
export function estimateDurationSec(
  size: number,
  p: AudioProfile,
  opts: { codec?: "wirehair" | "lt"; filenameBytes?: number } = {},
): number {
  const codec = opts.codec ?? "wirehair";
  const blockSize = effectiveBlockSize(p.blockSize, Math.max(1, size));
  const k = Math.max(1, Math.ceil(Math.max(1, size) / blockSize));
  const data = symbolsNeeded(k, codec);
  const metas = Math.ceil(data / META_INTERVAL);
  const tData = packetDurationSec(p, dataBodyLen(blockSize));
  const tMeta = packetDurationSec(p, metadataBodyLen(opts.filenameBytes ?? 11));
  return data * tData + metas * tMeta;
}
