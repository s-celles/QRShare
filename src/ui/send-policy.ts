import { getByteCapacity } from "@/qr/renderer";
import {
  AUDIO_MAX_BYTES,
  AUDIO_SUGGESTED_MAX_BYTES,
  estimateDurationSec,
  getProfile,
  type AudioProfile,
} from "@/audio/profiles";

export type SendPolicy = "airgap" | "prefer-airgap" | "any";
export type SendMode = "static-qr" | "animated-qr" | "cimbar" | "audio" | "webrtc" | "share";

export const STATIC_QR_MAX_BYTES = getByteCapacity(40, "M");

export function parseSendPolicy(value: string | null): SendPolicy {
  if (value === "airgap" || value === "prefer-airgap" || value === "any") {
    return value;
  }
  return "prefer-airgap";
}

export function payloadSize(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Transfer modes allowed by a policy. Audio (an air-gapped mode) is offered only
 * when the raw payload size is unknown or at most AUDIO_MAX_BYTES (REQ-AUD-002).
 */
export function allowedSendModes(policy: SendPolicy, size?: number): SendMode[] {
  const airgapped: SendMode[] = ["static-qr", "animated-qr", "cimbar"];
  if (size === undefined || size <= AUDIO_MAX_BYTES) airgapped.push("audio");
  if (policy === "airgap") return airgapped;
  return [...airgapped, "webrtc", "share"];
}

/**
 * `cameraAvailable === false` (no `videoinput` device) with a payload of at most
 * 1 KiB recommends audio (REQ-AUD-003); every policy permits air-gapped modes.
 * Otherwise audio is never recommended: it is Experimental and slower than QR.
 */
export function recommendSendMode(text: string, policy: SendPolicy, cameraAvailable?: boolean): SendMode {
  return recommendSendModeForSize(payloadSize(text), policy, true, cameraAvailable);
}

export function recommendSendModeForSize(
  size: number,
  policy: SendPolicy,
  supportsStaticQr: boolean,
  cameraAvailable?: boolean,
): SendMode {
  if (cameraAvailable === false && size <= AUDIO_SUGGESTED_MAX_BYTES) return "audio";
  if (supportsStaticQr && size <= STATIC_QR_MAX_BYTES) return "static-qr";
  if (policy === "airgap" || policy === "prefer-airgap") return "animated-qr";
  return "webrtc";
}

export interface AudioOptionDescription {
  /** Within the hard limit (AUDIO_MAX_BYTES). */
  readonly allowed: boolean;
  /** Within the suggested size (AUDIO_SUGGESTED_MAX_BYTES). */
  readonly suitable: boolean;
  /** Estimated minimum airtime, using the raw size as an upper bound. */
  readonly estimatedSec: number;
}

/** Chooser / invitation description of the audio option (REQ-AUD-004). */
export function describeAudioOption(size: number, profile: AudioProfile = getProfile("robust")): AudioOptionDescription {
  return {
    allowed: size <= AUDIO_MAX_BYTES,
    suitable: size <= AUDIO_SUGGESTED_MAX_BYTES,
    estimatedSec: estimateDurationSec(size, profile),
  };
}

/**
 * Camera availability from `enumerateDevices()`: true with a `videoinput`, false
 * when devices are listed but none is a camera, undefined when nothing is listed.
 */
export function cameraFromDevices(devices: ReadonlyArray<{ kind: string }>): boolean | undefined {
  if (devices.length === 0) return undefined;
  return devices.some((d) => d.kind === "videoinput");
}

/** Detects whether this device has a camera (undefined when unknown). */
export async function detectCamera(): Promise<boolean | undefined> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return undefined;
    return cameraFromDevices(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return undefined;
  }
}

/** Short duration label: "25 s" below 90 s, otherwise whole minutes. */
export function formatDuration(sec: number): string {
  return sec < 90 ? `${Math.ceil(sec)} s` : `${Math.round(sec / 60)} min`;
}

/**
 * Keeps the selected invitation mode while the content still allows it; otherwise
 * falls back to the recommendation, or to the first allowed mode.
 */
export function pickInvitationMode<M extends SendMode>(current: M, recommended: SendMode, allowed: readonly M[]): M {
  if (allowed.includes(current)) return current;
  const rec = allowed.find((m) => m === recommended);
  return rec ?? allowed[0] ?? current;
}

export function buildSendUrl(baseUrl: string, text: string, policy: SendPolicy): string {
  const base = baseUrl.split("#", 1)[0];
  const params = new URLSearchParams({ data: text, policy });
  return `${base}#/send?${params.toString()}`;
}

const RECEIVER_ROUTES: Record<Exclude<SendMode, "share">, string> = {
  "static-qr": "/scan",
  "animated-qr": "/receive/qr",
  cimbar: "/receive/cimbar",
  audio: "/receive/audio",
  webrtc: "/receive/webrtc",
};

export function buildReceiverUrl(
  baseUrl: string,
  mode: Exclude<SendMode, "share">,
  policy: SendPolicy,
): string {
  const base = baseUrl.split("#", 1)[0];
  return `${base}#${RECEIVER_ROUTES[mode]}?policy=${policy}`;
}
