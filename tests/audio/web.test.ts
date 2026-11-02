import { describe, expect, it } from "bun:test";
import { CAPTURE_CONSTRAINTS, startCapture, MicrophoneError, type CaptureDeps } from "@/audio/web/capture";
import { WORKLET_PROCESSOR_NAME, WORKLET_SOURCE } from "@/audio/web/worklet-source";
import { LookaheadScheduler, AudioPlayer, LOOKAHEAD_SEC, SampleRateTooLowError, type PlayerDeps, type PlayerProgress } from "@/audio/web/playback";
import { AudioSendSession } from "@/audio/session";
import { getProfile } from "@/audio/profiles";

// ------------------------------------------------------------------ fakes

class FakeNode {
  connected: unknown[] = [];
  disconnected = false;
  onaudioprocess: ((e: unknown) => void) | null = null;
  port = { onmessage: null as ((e: { data: ArrayBuffer }) => void) | null, close() {} };
  gain = { value: 1 };
  connect(n: unknown) {
    this.connected.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
}

function fakeContext(opts: { worklet: "ok" | "fail" | "missing"; state?: string }) {
  const ctx = {
    sampleRate: 44100,
    state: opts.state ?? "running",
    currentTime: 0,
    destination: new FakeNode(),
    closed: false,
    created: [] as FakeNode[],
    audioWorklet: opts.worklet === "missing" ? undefined : {
      addModule: (url: string) => (opts.worklet === "ok" ? Promise.resolve(url) : Promise.reject(new Error("blocked"))),
    },
    createMediaStreamSource() {
      const n = new FakeNode();
      ctx.created.push(n);
      return n;
    },
    createGain() {
      const n = new FakeNode();
      ctx.created.push(n);
      return n;
    },
    createScriptProcessor(size: number, inCh: number, outCh: number) {
      const n = new FakeNode() as FakeNode & { args: number[] };
      n.args = [size, inCh, outCh];
      ctx.created.push(n);
      return n;
    },
    resume() {
      ctx.state = "running";
      return Promise.resolve();
    },
    close() {
      ctx.closed = true;
      ctx.state = "closed";
      return Promise.resolve();
    },
  };
  return ctx;
}

function fakeStream() {
  const track = { stopped: false, stop() { track.stopped = true; } };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

function captureDeps(ctx: ReturnType<typeof fakeContext>, stream: MediaStream, log: string[]): CaptureDeps {
  return {
    getUserMedia: (c) => {
      log.push(JSON.stringify(c));
      return Promise.resolve(stream);
    },
    createContext: () => ctx as unknown as AudioContext,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: (u) => log.push(`revoke ${u}`),
    createWorkletNode: () => {
      const n = new FakeNode();
      ctx.created.push(n);
      log.push("worklet-node");
      return n as unknown as AudioWorkletNode;
    },
  };
}

// ------------------------------------------------------------------ capture

describe("capture (REQ-AUD-030, 090, 091)", () => {
  it("requests a raw mono microphone without processing", () => {
    expect(CAPTURE_CONSTRAINTS).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    });
  });

  it("ships the worklet as an inline source string", () => {
    expect(WORKLET_SOURCE).toContain("registerProcessor");
    expect(WORKLET_SOURCE).toContain(WORKLET_PROCESSOR_NAME);
  });

  it("uses the AudioWorklet from a Blob URL and a zero-gain sink", async () => {
    const ctx = fakeContext({ worklet: "ok" });
    const { stream, track } = fakeStream();
    const log: string[] = [];
    const chunks: Float32Array[] = [];
    const handle = await startCapture((c) => chunks.push(c), captureDeps(ctx, stream, log));
    expect(handle.backend).toBe("worklet");
    expect(handle.sampleRate).toBe(44100);
    expect(log[0]).toBe(JSON.stringify(CAPTURE_CONSTRAINTS));
    expect(log).toContain("worklet-node");
    expect(log).toContain("revoke blob:fake");
    const sink = ctx.created.find((n) => n.gain.value === 0);
    expect(sink).toBeDefined();
    expect(sink!.connected).toContain(ctx.destination);
    // Worklet messages become chunks.
    const node = ctx.created.find((n) => n.port.onmessage);
    node!.port.onmessage!({ data: new Float32Array([0.1, 0.2]).buffer });
    expect(chunks.length).toBe(1);
    expect(chunks[0][1]).toBeCloseTo(0.2);
    await handle.stop();
    expect(track.stopped).toBe(true);
    expect(ctx.closed).toBe(true);
  });

  it("falls back to a ScriptProcessor when addModule fails", async () => {
    const ctx = fakeContext({ worklet: "fail" });
    const { stream } = fakeStream();
    const handle = await startCapture(() => {}, captureDeps(ctx, stream, []));
    expect(handle.backend).toBe("script-processor");
    const sp = ctx.created.find((n) => (n as FakeNode & { args?: number[] }).args) as FakeNode & { args: number[] };
    expect(sp.args).toEqual([4096, 1, 1]);
    await handle.stop();
  });

  it("falls back when AudioWorklet is missing", async () => {
    const ctx = fakeContext({ worklet: "missing" });
    const { stream } = fakeStream();
    const handle = await startCapture(() => {}, captureDeps(ctx, stream, []));
    expect(handle.backend).toBe("script-processor");
    await handle.stop();
  });

  it("maps permission and device errors", async () => {
    const ctx = fakeContext({ worklet: "ok" });
    const fail = (name: string): CaptureDeps => ({
      ...captureDeps(ctx, fakeStream().stream, []),
      getUserMedia: () => Promise.reject(Object.assign(new Error(name), { name })),
    });
    await expect(startCapture(() => {}, fail("NotAllowedError"))).rejects.toMatchObject({ code: "denied" });
    await expect(startCapture(() => {}, fail("NotFoundError"))).rejects.toMatchObject({ code: "unavailable" });
    const e = await startCapture(() => {}, fail("NotFoundError")).catch((x) => x);
    expect(e).toBeInstanceOf(MicrophoneError);
  });

  it("reports a suspended context and resumes it on demand (REQ-AUD-032)", async () => {
    const ctx = fakeContext({ worklet: "ok", state: "suspended" });
    const handle = await startCapture(() => {}, captureDeps(ctx, fakeStream().stream, []));
    expect(handle.suspended).toBe(true);
    expect(await handle.resume()).toBe(true);
    expect(handle.suspended).toBe(false);
    await handle.stop();
  });
});

// ------------------------------------------------------------------ playback

describe("look-ahead scheduler (REQ-AUD-015)", () => {
  it("keeps at least 2 s queued, back to back without gaps", () => {
    const s = new LookaheadScheduler();
    const starts: number[] = [];
    const schedule = (at: number) => {
      starts.push(at);
      return 1.07;
    };
    s.fill(0, schedule);
    expect(s.nextStartTime - 0).toBeGreaterThanOrEqual(LOOKAHEAD_SEC);
    s.fill(0.5, schedule);
    s.fill(1.0, schedule);
    s.fill(2.5, schedule);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(1.07, 9);
    expect(s.nextStartTime - 2.5).toBeGreaterThanOrEqual(LOOKAHEAD_SEC);
  });

  it("re-anchors after an underrun instead of scheduling in the past", () => {
    const s = new LookaheadScheduler();
    s.fill(0, () => 0.5);
    const starts: number[] = [];
    s.fill(100, (at) => {
      starts.push(at);
      return 0.5;
    });
    expect(starts[0]).toBeGreaterThan(100);
  });
});

describe("AudioPlayer (REQ-AUD-014, 015, 019, 020)", () => {
  function playerFakes() {
    const sources: { startAt: number; stopped: boolean; disconnected: boolean }[] = [];
    let tick: (() => void) | null = null;
    let cleared = false;
    let wakeReleased = false;
    let audioSessionType = "";
    const ctx = {
      sampleRate: 48000,
      currentTime: 0,
      state: "running",
      closed: false,
      destination: {},
      createBuffer: (_c: number, len: number, sr: number) => ({ duration: len / sr, copyToChannel() {} }),
      createBufferSource: () => {
        const rec = { startAt: -1, stopped: false, disconnected: false };
        sources.push(rec);
        return {
          buffer: null,
          onended: null,
          connect() {},
          disconnect() {
            rec.disconnected = true;
          },
          start(t: number) {
            rec.startAt = t;
          },
          stop() {
            rec.stopped = true;
          },
        };
      },
      resume: () => Promise.resolve(),
      close() {
        ctx.closed = true;
        return Promise.resolve();
      },
    };
    const deps: PlayerDeps = {
      createContext: () => ctx as unknown as AudioContext,
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval: () => {
        cleared = true;
      },
      requestWakeLock: () => Promise.resolve({ release: () => { wakeReleased = true; return Promise.resolve(); } }),
      setAudioSessionType: (t) => {
        audioSessionType = t;
      },
    };
    return { ctx, sources, deps, runTick: () => tick?.(), state: () => ({ cleared, wakeReleased, audioSessionType }) };
  }

  it("schedules packets ahead, reports progress and tears everything down on stop", async () => {
    const f = playerFakes();
    const session = await AudioSendSession.create(new TextEncoder().encode("hello"), "message.txt", {
      isText: true,
      profile: getProfile("fast"),
    });
    const progress: PlayerProgress[] = [];
    const player = await AudioPlayer.start(session, (p) => progress.push(p), f.deps);
    expect(f.state().audioSessionType).toBe("playback");
    expect(f.sources.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < f.sources.length; i++) expect(f.sources[i].startAt).toBeGreaterThan(f.sources[i - 1].startAt);

    f.ctx.currentTime = 1.5;
    f.runTick();
    const last = progress[progress.length - 1];
    expect(last.packetsSent).toBeGreaterThanOrEqual(1);
    expect(last.elapsedSec).toBeCloseTo(1.5 - f.sources[0].startAt, 6);

    await player.stop();
    expect(f.sources.every((s) => s.stopped && s.disconnected)).toBe(true);
    expect(f.ctx.closed).toBe(true);
    expect(f.state().cleared).toBe(true);
    expect(f.state().wakeReleased).toBe(true);
    session.free();
  });
});

// ------------------------------------------------------------- review fixes

import { StartGuard, runGuarded } from "@/audio/web/start-guard";

describe("StartGuard / runGuarded (review items 2, 3)", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("returns the started resource in the normal case", async () => {
    const guard = new StartGuard();
    const released: string[] = [];
    const v = await runGuarded(guard, async () => "mic", async (x) => void released.push(x));
    expect(v).toBe("mic");
    expect(released).toEqual([]);
  });

  it("ignores a second start while the first is pending (double tap)", async () => {
    const guard = new StartGuard();
    const d = deferred<string>();
    let starts = 0;
    const first = runGuarded(guard, () => (starts++, d.promise), async () => {});
    const second = await runGuarded(guard, async () => (starts++, "other"), async () => {});
    expect(second).toBeNull();
    d.resolve("mic");
    expect(await first).toBe("mic");
    expect(starts).toBe(1);
  });

  it("releases a resource that finishes starting after unmount", async () => {
    const guard = new StartGuard();
    const d = deferred<string>();
    const released: string[] = [];
    const pending = runGuarded(guard, () => d.promise, async (x) => void released.push(x));
    guard.dispose();
    d.resolve("mic");
    expect(await pending).toBeNull();
    expect(released).toEqual(["mic"]);
    expect(await runGuarded(guard, async () => "again", async () => {})).toBeNull();
  });

  it("releases a resource superseded by a stop during start", async () => {
    const guard = new StartGuard();
    const d = deferred<string>();
    const released: string[] = [];
    const pending = runGuarded(guard, () => d.promise, async (x) => void released.push(x));
    guard.invalidate();
    d.resolve("mic");
    expect(await pending).toBeNull();
    expect(released).toEqual(["mic"]);
    // A new start is allowed after a stop.
    expect(await runGuarded(guard, async () => "next", async () => {})).toBe("next");
  });

  it("lets a failed start be retried", async () => {
    const guard = new StartGuard();
    await expect(runGuarded(guard, async () => { throw new Error("denied"); }, async () => {})).rejects.toThrow("denied");
    expect(await runGuarded(guard, async () => "ok", async () => {})).toBe("ok");
  });
});

describe("AudioPlayer review fixes (item 10)", () => {
  function minimalDeps(sampleRate: number) {
    const sources: number[] = [];
    let visibility: (() => void) | null = null;
    let wakeRequests = 0;
    let closed = false;
    const ctx = {
      sampleRate,
      currentTime: 0,
      state: "running",
      destination: {},
      createBuffer: (_c: number, len: number, sr: number) => ({ duration: len / sr, copyToChannel() {} }),
      createBufferSource: () => ({
        buffer: null, onended: null, connect() {}, disconnect() {}, stop() {},
        start(t: number) { sources.push(t); },
      }),
      resume: () => Promise.resolve(),
      close() { closed = true; return Promise.resolve(); },
    };
    const deps: PlayerDeps = {
      createContext: () => ctx as unknown as AudioContext,
      setInterval: () => 1,
      clearInterval: () => {},
      requestWakeLock: () => { wakeRequests++; return Promise.resolve({ release: () => Promise.resolve() }); },
      setAudioSessionType: () => {},
      onVisible: (cb) => { visibility = cb; return () => { visibility = null; }; },
    };
    return { deps, sources, fireVisible: () => visibility?.(), state: () => ({ closed, wakeRequests, listening: visibility !== null }) };
  }

  it("refuses a profile above the context's capability before scheduling anything", async () => {
    const f = minimalDeps(22050);
    const session = await AudioSendSession.create(new TextEncoder().encode("hi there"), "m.txt", {
      isText: true,
      profile: getProfile("ultrasonic"),
    });
    await expect(AudioPlayer.start(session, () => {}, f.deps)).rejects.toBeInstanceOf(SampleRateTooLowError);
    expect(f.sources.length).toBe(0);
    expect(f.state().closed).toBe(true);
    expect(session.packetsSent).toBe(0);
    session.free();
  });

  it("re-acquires the wake lock when the page becomes visible again, until stopped", async () => {
    const f = minimalDeps(48000);
    const session = await AudioSendSession.create(new TextEncoder().encode("hi there"), "m.txt", {
      isText: true,
      profile: getProfile("fast"),
    });
    const player = await AudioPlayer.start(session, () => {}, f.deps);
    await Promise.resolve();
    const before = f.state().wakeRequests;
    f.fireVisible();
    await Promise.resolve();
    expect(f.state().wakeRequests).toBe(before + 1);
    await player.stop();
    expect(f.state().listening).toBe(false);
    session.free();
  });
});
