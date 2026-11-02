/**
 * Runtime of an audio session (REQ-ALS-020, 030..032): microphone → demodulator →
 * room (session packets) or sealed-transfer receiver (session files); room frames
 * and file packets → modulator → speaker, each transmission waiting for its turn
 * (`LinkMac`). Web Audio glue; the protocol logic lives in `link/`.
 */

import { StreamingDemodulator } from "../demodulator";
import { modulate } from "../modem";
import { encodeOnAir } from "../packet";
import { profileByIndex, type AudioProfile } from "../profiles";
import { AudioReceiveSession, AudioSendSession, type ReceiveComplete } from "../session";
import { LinkMac } from "../link/mac";
import type { AudioRoom, LinkPacket, RoomEvent } from "../link/room";
import { startCapture, type CaptureHandle } from "./capture";

const TICK_MS = 100;
/** Silence after each file metadata packet, so members can acknowledge (REQ-ALS-031). */
const FILE_LISTEN_MS = 1500;

export interface LinkRuntimeHandlers {
  onRoomEvents(events: RoomEvent[]): void;
  onLevel?(rmsDbfs: number, peak: number): void;
  onFileReceived?(file: ReceiveComplete): void;
  onFileSendProgress?(state: { packets: number; done: number; total: number; active: boolean }): void;
  onTransmitting?(active: boolean): void;
  onError?(message: string): void;
}

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

interface FileSend {
  session: AudioSendSession;
  id: string;
  doneBy: Set<number>;
  packets: number;
  maxPackets: number;
  holdUntil: number;
}

export class AudioLinkRuntime {
  private readonly mac = new LinkMac();
  private readonly demod: StreamingDemodulator;
  private readonly out: AudioContext;
  private interval: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private busyUntil = 0;
  private sending = false;
  private fileRx: AudioReceiveSession | null = null;
  private fileTx: FileSend | null = null;
  private stopped = false;

  private constructor(
    private readonly room: AudioRoom,
    private readonly capture: CaptureHandle,
    private readonly handlers: LinkRuntimeHandlers,
  ) {
    this.demod = new StreamingDemodulator(capture.sampleRate);
    this.out = new AudioContext({ latencyHint: "interactive" });
  }

  /** Must be called from a user gesture (microphone permission, audio output). */
  static async start(room: AudioRoom, handlers: LinkRuntimeHandlers): Promise<AudioLinkRuntime> {
    let runtime: AudioLinkRuntime | null = null;
    const capture = await startCapture((chunk) => runtime?.onChunk(chunk));
    runtime = new AudioLinkRuntime(room, capture, handlers);
    if (capture.suspended) await capture.resume();
    if (runtime.out.state === "suspended") await runtime.out.resume().catch(() => {});
    runtime.interval = setInterval(() => runtime!.enqueue(() => runtime!.tick()), TICK_MS);
    return runtime;
  }

  get suspended(): boolean {
    return this.capture.suspended || this.out.state === "suspended";
  }

  async resume(): Promise<void> {
    await this.capture.resume();
    await this.out.resume().catch(() => {});
  }

  private get profile(): AudioProfile {
    return profileByIndex(this.room.profileIndex) ?? profileByIndex(0)!;
  }

  private enqueue(job: () => Promise<void> | void): void {
    this.chain = this.chain.then(job).catch((err) => this.handlers.onError?.(err instanceof Error ? err.message : String(err)));
  }

  private onChunk(chunk: Float32Array): void {
    if (this.stopped) return;
    this.enqueue(async () => {
      for (const ev of this.demod.push(chunk)) {
        if (ev.kind === "level") this.handlers.onLevel?.(ev.rmsDbfs, ev.peak);
        if (ev.kind !== "packet" || ev.result.kind !== "ok") continue;
        const packet = ev.result.packet;
        if (packet.kind === "link") {
          const events = await this.room.receive(packet as LinkPacket);
          this.onRoomEvents(events);
        } else {
          await this.onTransferPacket(ev.result, ev.profile);
        }
      }
    });
  }

  private onRoomEvents(events: RoomEvent[]): void {
    if (!events.length) return;
    const tx = this.fileTx;
    if (tx) {
      for (const e of events) if (e.kind === "file_done" && e.transferId === tx.id) tx.doneBy.add(e.from);
      this.reportFile();
    }
    this.handlers.onRoomEvents(events);
  }

  /** Session files are sealed transfers whose password derives from the group key. */
  private async onTransferPacket(result: Parameters<AudioReceiveSession["ingest"]>[0], profile: Parameters<AudioReceiveSession["ingest"]>[1]): Promise<void> {
    if (result.kind !== "ok") return;
    const p = result.packet;
    const id = p.kind === "data" ? p.metadataHash : p.kind === "sealed-metadata" ? p.metadataHash : null;
    if (!id) return;
    const idHex = Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");
    if (this.fileTx && idHex === this.fileTx.id) return; // our own file, heard back
    const password = await this.room.filePassword();
    if (!password || this.room.state !== "member") return;
    this.fileRx ??= new AudioReceiveSession(this.capture.sampleRate, { password });
    for (const ev of await this.fileRx.ingest(result, profile)) {
      if (ev.kind === "error") {
        this.fileRx.free();
        this.fileRx = null; // not a session file (another password): forget it
        return;
      }
      if (ev.kind === "complete") {
        const transferId = this.fileRx.lockedSessionId;
        this.fileRx.free();
        this.fileRx = null;
        this.handlers.onFileReceived?.(ev);
        if (transferId) {
          this.room.sendFileDone(hexToBytes(transferId));
        }
        return;
      }
    }
  }

  /** Sends a file or long text to the session (REQ-ALS-030, 031). */
  async sendFile(data: Uint8Array, filename: string, isText: boolean): Promise<void> {
    const password = await this.room.filePassword();
    if (!password) throw new Error("Not in a session");
    this.cancelFile();
    const session = await AudioSendSession.create(data, filename, { isText, profile: this.profile, password });
    this.fileTx = {
      session,
      id: session.info.sessionId,
      doneBy: new Set(),
      packets: 0,
      maxPackets: (session.info.k + 4) * 4 + 30,
      holdUntil: 0,
    };
    this.reportFile();
  }

  cancelFile(): void {
    if (!this.fileTx) return;
    this.fileTx.session.free();
    this.fileTx = null;
    this.reportFile();
  }

  private reportFile(): void {
    const tx = this.fileTx;
    const total = this.room.memberViews().filter((m) => !m.self).length;
    if (!tx) {
      this.handlers.onFileSendProgress?.({ packets: 0, done: 0, total, active: false });
      return;
    }
    const done = this.room.memberViews().filter((m) => !m.self && tx.doneBy.has(m.id)).length;
    if (total > 0 && done >= total) {
      this.handlers.onFileSendProgress?.({ packets: tx.packets, done, total, active: false });
      tx.session.free();
      this.fileTx = null;
      return;
    }
    this.handlers.onFileSendProgress?.({ packets: tx.packets, done, total, active: true });
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.onRoomEvents(this.room.tick());
    const now = performance.now();
    const busy = this.sending || this.demod.busy || now < this.busyUntil;
    const want = this.room.hasDue() || (this.fileTx !== null && now >= this.fileTx.holdUntil);
    if (!this.mac.update(now, busy) || !want) return;

    // Session frames (acks, messages) first; file packets in the remaining turns.
    const frame = this.room.hasDue() ? await this.room.nextFrame() : null;
    if (frame) {
      this.play(encodeOnAir(frame, this.profile));
      return;
    }
    const tx = this.fileTx;
    if (!tx || now < tx.holdUntil) return;
    const pkt = tx.session.nextPacket();
    tx.packets++;
    const duration = this.play(pkt.bytes);
    if (pkt.kind === "metadata") tx.holdUntil = performance.now() + duration + FILE_LISTEN_MS;
    if (tx.packets >= tx.maxPackets) this.cancelFile();
    else this.reportFile();
  }

  /** Plays one on-air packet now; returns its duration (ms). */
  private play(onAir: Uint8Array): number {
    const samples = modulate(onAir, this.profile, this.out.sampleRate);
    const buffer = this.out.createBuffer(1, samples.length, this.out.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = this.out.createBufferSource();
    node.buffer = buffer;
    node.connect(this.out.destination);
    const durationMs = buffer.duration * 1000;
    const now = performance.now();
    this.sending = true;
    this.handlers.onTransmitting?.(true);
    this.mac.transmitted(now, durationMs);
    this.busyUntil = now + durationMs;
    node.onended = () => {
      this.sending = false;
      this.handlers.onTransmitting?.(false);
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    node.start();
    return durationMs;
  }

  /** Leaves the room (best effort: the leave message is played at once) and releases audio. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    if (this.room.state === "member") {
      this.room.leave();
      const frame = await this.room.nextFrame();
      if (frame) {
        const ms = this.play(encodeOnAir(frame, this.profile));
        await new Promise((r) => setTimeout(r, ms + 100));
      }
    }
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.cancelFile();
    this.fileRx?.free();
    await this.capture.stop();
    await this.out.close().catch(() => {});
  }
}

