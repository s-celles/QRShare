/**
 * Speaker playback for the audio sender (REQ-AUD-014, 015, 019, 020).
 *
 * A look-ahead scheduler keeps at least LOOKAHEAD_SEC of packets queued as
 * AudioBufferSourceNodes started back to back on the AudioContext clock, so
 * timer throttling never opens gaps. A 250 ms interval tops the queue up and
 * reports progress for packets that have actually started.
 */

import type { AudioSendSession } from "../session";

export const LOOKAHEAD_SEC = 2;
export const TICK_MS = 250;
/** Small lead so the first packet is not scheduled in the past. */
const START_LEAD_SEC = 0.05;

export class LookaheadScheduler {
  nextStartTime = 0;

  constructor(private readonly lookaheadSec = LOOKAHEAD_SEC) {}

  /**
   * Schedules packets until at least `lookaheadSec` is queued after `currentTime`.
   * `schedule(at)` starts one packet at `at` and returns its duration.
   */
  fill(currentTime: number, schedule: (at: number) => number): number {
    if (this.nextStartTime < currentTime + START_LEAD_SEC / 2) this.nextStartTime = currentTime + START_LEAD_SEC;
    let count = 0;
    while (this.nextStartTime - currentTime < this.lookaheadSec) {
      this.nextStartTime += schedule(this.nextStartTime);
      count++;
    }
    return count;
  }
}

export interface PlayerProgress {
  readonly packetsSent: number;
  readonly uniqueSymbols: number;
  readonly elapsedSec: number;
}

interface WakeLockLike {
  release(): Promise<void>;
}

export interface PlayerDeps {
  createContext(): AudioContext;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  requestWakeLock(): Promise<WakeLockLike | null>;
  setAudioSessionType(type: string): void;
  /** Calls `cb` whenever the page becomes visible again; returns an unsubscribe. */
  onVisible?(cb: () => void): () => void;
}

/** The output context runs below the profile's minimum sample rate (e.g. Ultrasonic). */
export class SampleRateTooLowError extends Error {
  constructor(readonly sampleRate: number, readonly required: number) {
    super(`Output sample rate ${sampleRate} Hz is below the ${required} Hz this profile needs`);
    this.name = "SampleRateTooLowError";
  }
}

export function defaultPlayerDeps(): PlayerDeps {
  return {
    createContext: () => new AudioContext({ latencyHint: "playback" }),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    requestWakeLock: async () => {
      try {
        return (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        return null;
      }
    },
    setAudioSessionType: (type) => {
      // Safari 16.4+: "playback" keeps output audible with the silent switch on.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) {
        try {
          session.type = type;
        } catch {
          /* unsupported value */
        }
      }
    },
    onVisible: (cb) => {
      const handler = () => {
        if (document.visibilityState === "visible") cb();
      };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}

interface Scheduled {
  readonly node: AudioBufferSourceNode;
  readonly startAt: number;
  readonly packetsSent: number;
  readonly uniqueSymbols: number;
}

export class AudioPlayer {
  private readonly scheduler = new LookaheadScheduler();
  private readonly queue: Scheduled[] = [];
  private readonly live = new Set<AudioBufferSourceNode>();
  private interval: unknown = null;
  private wakeLock: WakeLockLike | null = null;
  private unsubscribeVisible: (() => void) | null = null;
  private firstStart = -1;
  private stopped = false;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly session: AudioSendSession,
    private readonly onProgress: (p: PlayerProgress) => void,
    private readonly deps: PlayerDeps,
  ) {}

  /** Must be called from a user gesture (autoplay policy, REQ-AUD-014). */
  static async start(
    session: AudioSendSession,
    onProgress: (p: PlayerProgress) => void,
    deps: PlayerDeps = defaultPlayerDeps(),
  ): Promise<AudioPlayer> {
    deps.setAudioSessionType("playback");
    const ctx = deps.createContext();
    // Check the rate before scheduling anything (e.g. Ultrasonic needs ≥ 44.1 kHz).
    if (ctx.sampleRate < session.profile.minSampleRate) {
      await ctx.close().catch(() => {});
      throw new SampleRateTooLowError(ctx.sampleRate, session.profile.minSampleRate);
    }
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const player = new AudioPlayer(ctx, session, onProgress, deps);
    player.pump();
    player.interval = deps.setInterval(() => player.pump(), TICK_MS);
    // The wake lock is acquired in the background and again whenever the page comes
    // back to the foreground (browsers release it when the page is hidden).
    void player.acquireWakeLock();
    player.unsubscribeVisible = deps.onVisible?.(() => void player.acquireWakeLock()) ?? null;
    return player;
  }

  private async acquireWakeLock(): Promise<void> {
    if (this.stopped) return;
    const lock = await this.deps.requestWakeLock();
    if (this.stopped) {
      await lock?.release().catch(() => {});
      return;
    }
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = lock;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  private scheduleOne(at: number): number {
    const samples = this.session.nextSamples(this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    node.onended = () => {
      this.live.delete(node);
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    node.start(at);
    this.live.add(node);
    if (this.firstStart < 0) this.firstStart = at;
    this.queue.push({
      node,
      startAt: at,
      packetsSent: this.session.packetsSent,
      uniqueSymbols: this.session.uniqueSymbolsSent,
    });
    return buffer.duration;
  }

  private pump(): void {
    if (this.stopped) return;
    this.scheduler.fill(this.ctx.currentTime, (at) => this.scheduleOne(at));
    const now = this.ctx.currentTime;
    let latest: Scheduled | null = null;
    while (this.queue.length && this.queue[0].startAt <= now) latest = this.queue.shift()!;
    if (latest) {
      this.onProgress({
        packetsSent: latest.packetsSent,
        uniqueSymbols: latest.uniqueSymbols,
        elapsedSec: Math.max(0, now - this.firstStart),
      });
    }
  }

  /** Stops every scheduled source, closes the context and releases the wake lock (REQ-AUD-020). */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.interval !== null) this.deps.clearInterval(this.interval);
    this.unsubscribeVisible?.();
    this.unsubscribeVisible = null;
    for (const s of this.queue) this.live.add(s.node);
    for (const node of this.live) {
      try {
        node.stop();
      } catch {
        /* not started or already stopped */
      }
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.live.clear();
    this.queue.length = 0;
    await this.ctx.close().catch(() => {});
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
