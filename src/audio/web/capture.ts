/**
 * Microphone capture for the audio receiver (REQ-AUD-030..032, REQ-AUD-090, 091).
 *
 * Graph: MediaStreamSource → AudioWorkletNode (or ScriptProcessor fallback)
 *        → GainNode(0) → destination. The zero-gain sink keeps the node pulled
 * by every engine without making the microphone audible.
 */

import { WORKLET_PROCESSOR_NAME, WORKLET_SOURCE } from "./worklet-source";

/** Raw mono input: browser speech processing would treat the tones as noise or echo. */
export const CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  video: false,
};

export const SCRIPT_PROCESSOR_BUFFER = 4096;

export type CaptureBackend = "worklet" | "script-processor";

export class MicrophoneError extends Error {
  constructor(readonly code: "denied" | "unavailable", message: string) {
    super(message);
    this.name = "MicrophoneError";
  }
}

export interface CaptureDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createWorkletNode(ctx: AudioContext, name: string): AudioWorkletNode;
}

export interface CaptureHandle {
  readonly sampleRate: number;
  readonly backend: CaptureBackend;
  /** True while the AudioContext waits for a user gesture. */
  readonly suspended: boolean;
  /** Resumes a suspended context (call from a click handler). */
  resume(): Promise<boolean>;
  stop(): Promise<void>;
}

export function defaultCaptureDeps(): CaptureDeps {
  return {
    getUserMedia: (c) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new MicrophoneError("unavailable", "getUserMedia is not available"));
      }
      return navigator.mediaDevices.getUserMedia(c);
    },
    createContext: () => new AudioContext({ latencyHint: "interactive" }),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    createWorkletNode: (ctx, name) =>
      new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 }),
  };
}

function toMicrophoneError(err: unknown): MicrophoneError {
  if (err instanceof MicrophoneError) return err;
  const name = (err as { name?: string })?.name ?? "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return new MicrophoneError("denied", message);
  }
  return new MicrophoneError("unavailable", message);
}

async function tryWorklet(
  ctx: AudioContext,
  deps: CaptureDeps,
  onChunk: (samples: Float32Array) => void,
): Promise<AudioNode | null> {
  if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") return null;
  const url = deps.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
    const node = deps.createWorkletNode(ctx, WORKLET_PROCESSOR_NAME);
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onChunk(new Float32Array(event.data));
    return node;
  } catch (err) {
    console.warn("[audio] AudioWorklet unavailable, falling back to ScriptProcessor:", err);
    return null;
  } finally {
    deps.revokeObjectURL(url);
  }
}

/** Opens the microphone and streams mono Float32 chunks to `onChunk`. */
export async function startCapture(
  onChunk: (samples: Float32Array) => void,
  deps: CaptureDeps = defaultCaptureDeps(),
): Promise<CaptureHandle> {
  let stream: MediaStream;
  try {
    stream = await deps.getUserMedia(CAPTURE_CONSTRAINTS);
  } catch (err) {
    throw toMicrophoneError(err);
  }

  const ctx = deps.createContext();
  try {
    const source = ctx.createMediaStreamSource(stream);
    let backend: CaptureBackend = "worklet";
    let node = await tryWorklet(ctx, deps, onChunk);
    if (!node) {
      backend = "script-processor";
      const sp = ctx.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1);
      sp.onaudioprocess = (event: AudioProcessingEvent) =>
        onChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
      node = sp;
    }
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    let stopped = false;
    return {
      sampleRate: ctx.sampleRate,
      backend,
      get suspended() {
        return ctx.state === "suspended";
      },
      async resume() {
        try {
          await ctx.resume();
        } catch {
          /* ignored: reported through `suspended` */
        }
        return ctx.state === "running";
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        stream.getTracks().forEach((t) => t.stop());
        try {
          source.disconnect();
          node.disconnect();
          sink.disconnect();
        } catch {
          /* already disconnected */
        }
        if ((node as AudioWorkletNode).port) (node as AudioWorkletNode).port.onmessage = null;
        await ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    throw err;
  }
}
