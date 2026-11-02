import { describe, expect, it } from "bun:test";
import { AudioLinkRuntime } from "@/audio/web/link-runtime";
import { AudioRoom } from "@/audio/link/room";
import type { CaptureHandle } from "@/audio/web/capture";

/** Fake output context: records played buffers; starts suspended like a context created outside a gesture. */
function fakeOutput(initial: "running" | "suspended") {
  const played: number[] = [];
  const ctx = {
    sampleRate: 48000,
    state: initial as string,
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    createBuffer: (_c: number, len: number, sr: number) => ({ duration: len / sr, copyToChannel() {} }),
    createBufferSource: () => ({
      buffer: null as unknown,
      onended: null as null | (() => void),
      connect() {},
      disconnect() {},
      start() {
        played.push(Date.now());
      },
      stop() {},
    }),
    resume() {
      ctx.resumeCalls++;
      ctx.state = "running";
      return Promise.resolve();
    },
    close() {
      ctx.state = "closed";
      return Promise.resolve();
    },
  };
  return { ctx, played };
}

function fakeCapture(): CaptureHandle {
  return { sampleRate: 48000, backend: "worklet", suspended: false, resume: async () => true, stop: async () => {} };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("audio session runtime: sound output (device bug: join never heard)", () => {
  it("plays on the output context created by the caller during the click", async () => {
    const room = await AudioRoom.host({ name: "Host" });
    const out = fakeOutput("running");
    const runtime = await AudioLinkRuntime.start(room, { onRoomEvents: () => {} }, {
      out: out.ctx as unknown as AudioContext,
      startCapture: async () => fakeCapture(),
    });
    for (let i = 0; i < 40 && out.played.length === 0; i++) await wait(100);
    expect(out.played.length).toBeGreaterThan(0); // the beacon went out of this context
    await runtime.stop();
  });

  it("reports a suspended output and resumes it on a later click", async () => {
    const room = await AudioRoom.guest({ name: "Guest" });
    const out = fakeOutput("suspended");
    // Simulate a browser that refuses to resume outside a gesture.
    const refuse = out.ctx.resume;
    out.ctx.resume = () => Promise.resolve();
    const states: boolean[] = [];
    const runtime = await AudioLinkRuntime.start(room, { onRoomEvents: () => {}, onAudioState: (s) => states.push(s) }, {
      out: out.ctx as unknown as AudioContext,
      startCapture: async () => fakeCapture(),
    });
    await wait(250);
    expect(runtime.suspended).toBe(true);
    expect(states[0]).toBe(true);
    out.ctx.resume = refuse; // now inside a click
    await runtime.resume();
    await wait(250);
    expect(runtime.suspended).toBe(false);
    expect(states[states.length - 1]).toBe(false);
    await runtime.stop();
  });
});
