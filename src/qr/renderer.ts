import { generate, mode, correction } from "lean-qr";
import type { Correction, Bitmap2D } from "lean-qr";

export type EncodingPreset = "high_speed" | "balanced" | "high_reliability";

export interface PresetConfig {
  readonly minVersion: number;
  readonly maxVersion: number;
  readonly correctionLevel: Correction;
  readonly correctionLabel: "L" | "M" | "Q" | "H";
  readonly targetFps: number;
}

const PRESETS: Record<EncodingPreset, PresetConfig> = {
  high_speed: {
    minVersion: 1,
    maxVersion: 25,
    correctionLevel: correction.L,
    correctionLabel: "L",
    targetFps: 15,
  },
  balanced: {
    minVersion: 1,
    maxVersion: 20,
    correctionLevel: correction.M,
    correctionLabel: "M",
    targetFps: 12,
  },
  high_reliability: {
    minVersion: 1,
    maxVersion: 15,
    correctionLevel: correction.Q,
    correctionLabel: "Q",
    targetFps: 8,
  },
};

/**
 * Max byte-mode capacity per QR version and ECC level.
 * Source: ISO 18004 Table 7.
 */
const BYTE_CAPACITY: Record<string, number[]> = {
  // [version] = max bytes at that ECC level
  L: [
    0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520,
    586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528,
    1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
  ],
  M: [
    0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412,
    450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264,
    1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
  ],
  Q: [
    0, 11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292,
    322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908,
    982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663,
  ],
  H: [
    0, 7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220,
    250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698,
    742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273,
  ],
};

export function getPresetConfig(preset: EncodingPreset): PresetConfig {
  return PRESETS[preset];
}

export function getMaxPayloadBytes(preset: EncodingPreset): number {
  const config = PRESETS[preset];
  const table = BYTE_CAPACITY[config.correctionLabel];
  return table[config.maxVersion];
}

export function renderQR(data: Uint8Array, preset: EncodingPreset): Bitmap2D {
  const config = PRESETS[preset];
  return generate(mode.bytes(data), {
    minVersion: config.minVersion,
    maxVersion: config.maxVersion,
    minCorrectionLevel: config.correctionLevel,
    maxCorrectionLevel: config.correctionLevel,
  });
}

export function renderQRToDataURL(
  data: Uint8Array,
  preset: EncodingPreset,
): string {
  const bitmap = renderQR(data, preset);
  return bitmap.toDataURL({ type: "image/png", scale: 8 });
}
