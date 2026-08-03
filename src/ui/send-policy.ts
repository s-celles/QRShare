import { getByteCapacity } from "@/qr/renderer";

export type SendPolicy = "airgap" | "prefer-airgap" | "any";
export type SendMode = "static-qr" | "animated-qr" | "webrtc" | "share";

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

export function allowedSendModes(policy: SendPolicy): SendMode[] {
  if (policy === "airgap") return ["static-qr", "animated-qr"];
  return ["static-qr", "animated-qr", "webrtc", "share"];
}

export function recommendSendMode(text: string, policy: SendPolicy): SendMode {
  return recommendSendModeForSize(payloadSize(text), policy, true);
}

export function recommendSendModeForSize(
  size: number,
  policy: SendPolicy,
  supportsStaticQr: boolean,
): SendMode {
  if (supportsStaticQr && size <= STATIC_QR_MAX_BYTES) return "static-qr";
  if (policy === "airgap" || policy === "prefer-airgap") return "animated-qr";
  return "webrtc";
}

export function buildSendUrl(baseUrl: string, text: string, policy: SendPolicy): string {
  const base = baseUrl.split("#", 1)[0];
  const params = new URLSearchParams({ data: text, policy });
  return `${base}#/send?${params.toString()}`;
}

export function buildReceiverUrl(
  baseUrl: string,
  mode: Exclude<SendMode, "share">,
  policy: SendPolicy,
): string {
  const base = baseUrl.split("#", 1)[0];
  const route = mode === "static-qr"
    ? "/scan"
    : mode === "animated-qr" ? "/receive/qr" : "/receive/webrtc";
  return `${base}#${route}?policy=${policy}`;
}
