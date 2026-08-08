import { signal } from "@preact/signals";
import { selfId } from "trystero/nostr";
import type { Room } from "trystero";
import { hashSha256 } from "@/crypto/hash";
import { getAdapter, ALL_STRATEGIES, type StrategyName, type StrategyAdapter, type JoinRoomConfig, type JoinErrorDetails } from "./strategies";
import { StrategyAgreement, type AgreementRoom } from "./agreement";
import {
  classifyFailure,
  probeIce,
  type ConnectionDiagnosis,
  type IceProbeResult,
} from "./diagnostics";
import {
  type RoomConfig,
  type BatchMetadata,
  type TransferMetadata,
  type TransferProgress,
  type MultiFileProgress,
  type ConnectionState,
  type StrategyAttemptStatus,
  DEFAULT_ROOM_CONFIG,
  ROOM_ID_LENGTH,
} from "./types";

const STRATEGY_TIMEOUT = 10_000;
/** How often to sample the live peer connection state (see startPeerSampling). */
const PEER_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Decide how a peer-leave affects the connection state.
 *
 * During an `editing` (collaborative) session a peer leaving is a recoverable
 * presence change, not a failed transfer: the local editor stays usable and edits
 * keep accumulating in the local Y.Doc (REQ-COLLAB-031, REQ-COLLAB-032). During a
 * completed transfer it is ignored. Otherwise it is a hard error.
 */
export function resolvePeerLeave(
  state: ConnectionState,
): { nextState: ConnectionState | null; peerOffline: boolean } {
  if (state === "editing") return { nextState: null, peerOffline: true };
  if (state === "complete") return { nextState: null, peerOffline: false };
  return { nextState: "error", peerOffline: true };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRoomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));
  return Array.from(values)
    .map((v) => chars[v % chars.length])
    .join("");
}

export function buildJoinConfig(config: RoomConfig, adapter: StrategyAdapter, roomId: string): JoinRoomConfig {
  const relayUrls = config.relayUrls?.[adapter.name];
  const joinConfig: JoinRoomConfig = {
    appId: config.appId,
    password: roomId,
    relayRedundancy: config.relayRedundancy,
    relayUrls: relayUrls?.length ? relayUrls : undefined,
  };

  const iceServers = config.iceServers ?? [];
  if (iceServers.length > 0) {
    // Trystero builds the peer as:
    //   new RTCPeerConnection({iceServers: defaultIceServers.concat(turnConfig || []), ...rtcConfig})
    // `rtcConfig` is spread last, so rtcConfig.iceServers overrides both the
    // trystero defaults and anything passed via turnConfig. It must therefore
    // list every server ICE should use — STUN *and* TURN, credentials included.
    joinConfig.rtcConfig = {
      iceServers: iceServers.map((s) => ({
        urls: s.urls,
        ...(s.username !== undefined && { username: s.username }),
        ...(s.credential !== undefined && { credential: s.credential }),
      })),
    };
  }

  if (joinConfig.rtcConfig) {
    const urlsOf = (s: { urls: string | string[] }) =>
      Array.isArray(s.urls) ? s.urls : [s.urls];
    const isTurn = (u: string) => u.startsWith("turn:") || u.startsWith("turns:");
    const all = joinConfig.rtcConfig.iceServers;
    console.log("[webrtc] ICE config:", {
      stun: all.filter((s) => urlsOf(s).some((u) => u.startsWith("stun:"))).length,
      turn: all.filter((s) => urlsOf(s).some(isTurn)).length,
      turnUrls: all.filter((s) => urlsOf(s).some(isTurn)).map((s) => s.urls),
    });
  }

  return joinConfig;
}

export class WebRTCService {
  readonly state = signal<ConnectionState>("idle");
  readonly confirmationCode = signal("");
  readonly error = signal<string | null>(null);
  readonly activeStrategy = signal<StrategyName | null>(null);
  readonly strategyAttempts = signal<StrategyAttemptStatus[]>([]);
  /** Whether the remote peer is currently connected (used in the collab editor). */
  readonly peerOnline = signal(false);
  /** Set when the remote peer signals they have started a collaborative session. */
  readonly collabRequested = signal(false);

  /**
   * Machine-readable cause of the last failure, for the UI to translate.
   * `error` is kept alongside it for compatibility.
   */
  readonly diagnosis = signal<ConnectionDiagnosis | null>(null);

  private room: Room | null = null;
  /** Runs only in `parallel` mode; `sequential` never negotiates a strategy. */
  private agreement: StrategyAgreement | null = null;
  /**
   * Last states sampled while the peer connection was still alive. By the time
   * `onPeerLeave` fires trystero has already closed it (`room.js:61-72`), so a
   * drop and a deliberate leave are otherwise indistinguishable.
   */
  private lastPeerConnectionState: RTCPeerConnectionState | undefined;
  private lastIceConnectionState: RTCIceConnectionState | undefined;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private sendCollabStart: (() => void) | null = null;
  private activeRooms: { strategy: StrategyName; room: Room }[] = [];
  private remotePeerId = "";
  private onFileReceivedCb:
    | ((metadata: TransferMetadata, data: Uint8Array) => void)
    | null = null;
  private onProgressCb: ((p: TransferProgress) => void) | null = null;
  private onBatchStartedCb: ((batch: BatchMetadata) => void) | null = null;
  private onBatchCompleteCb: (() => void) | null = null;

  async createReceiver(
    config: RoomConfig = DEFAULT_ROOM_CONFIG,
    customRoomId?: string,
  ): Promise<{ roomId: string }> {
    const roomId = customRoomId?.trim() || generateRoomId();
    this.state.value = "waiting";

    const strategies = config.strategies ?? ALL_STRATEGIES;
    const adapters = await Promise.all(strategies.map(getAdapter));
    const mode = config.connectionMode ?? "parallel";

    if (mode === "sequential") {
      return this.createReceiverSequential(roomId, config, adapters);
    }
    return this.createReceiverParallel(roomId, config, adapters);
  }

  private createReceiverParallel(
    roomId: string,
    config: RoomConfig,
    adapters: StrategyAdapter[],
  ): { roomId: string } {
    const rooms: { strategy: StrategyName; room: Room }[] = [];
    for (const adapter of adapters) {
      try {
        const joinConfig = buildJoinConfig(config, adapter, roomId);
        const room = adapter.joinRoom(joinConfig, roomId, (d) => this.handleJoinError(d));
        rooms.push({ strategy: adapter.name, room });
      } catch (err) {
        console.warn(`[webrtc] Strategy ${adapter.name} failed to join:`, err);
      }
    }

    if (rooms.length === 0) {
      this.state.value = "error";
      this.error.value = "All signaling strategies failed to initialize.";
      this.diagnosis.value = classifyFailure({ outcome: "no-strategy-initialized" });
      throw new Error("All signaling strategies failed");
    }

    this.activeRooms = rooms;
    this.strategyAttempts.value = rooms.map((r) => ({
      strategy: r.strategy,
      status: "connecting" as const,
    }));

    console.log(
      "[webrtc] Receiver joined room:",
      roomId,
      "selfId:",
      selfId,
      "strategies:",
      rooms.map((r) => r.strategy),
    );

    // The agreement owns every room's peer events until a strategy is agreed: it
    // decides which one to keep and tears down the rest. Adopting our own
    // first-to-connect here is what let the two peers disagree and kill each other.
    this.agreement = this.startAgreement(rooms, (entry, peerId) => {
      this.adoptStrategy(entry, peerId, rooms);
      this.setupReceiverActions(entry.room);
    });

    return { roomId };
  }

  /**
   * Adopt the strategy agreed with the remote peer. Shared by the receiver and
   * sender parallel paths; the losing rooms have already been left by the agreement.
   */
  private adoptStrategy(
    entry: { strategy: StrategyName; room: Room },
    peerId: string,
    rooms: { strategy: StrategyName; room: Room }[],
  ): void {
    const { strategy, room } = entry;
    console.log("[webrtc] Agreed strategy:", strategy, "peer:", peerId);

    this.room = room;
    this.activeStrategy.value = strategy;
    this.remotePeerId = peerId;
    this.state.value = "confirming";
    this.deriveConfirmationCode();
    this.peerOnline.value = true;
    this.setupCollabSignal(room);

    this.strategyAttempts.value = rooms.map((r) => ({
      strategy: r.strategy,
      status: r.strategy === strategy ? "connected" : "cancelled",
    }));
    this.activeRooms = [{ strategy, room }];

    // Trystero's onPeerLeave is a single-slot assignment (`room.js:387`), so this
    // deliberately takes the handler back from the agreement for the room we kept.
    // Pre-agreement leaves were the agreement's business (mark the strategy dead,
    // never an error); post-agreement leaves are `resolvePeerLeave` policy.
    room.onPeerLeave((id) => this.handlePeerLeave(room, id));
    this.startPeerSampling(room, peerId);
  }

  /** Wire a `StrategyAgreement` over the joined rooms. */
  private startAgreement(
    rooms: { strategy: StrategyName; room: Room }[],
    onActivate: (entry: { strategy: StrategyName; room: Room }, peerId: string) => void,
  ): StrategyAgreement {
    return new StrategyAgreement({
      selfId,
      // trystero's `Room.makeAction` generic is not structurally assignable to the
      // narrower AgreementRoom; the shape matches at runtime (same cast as
      // CollabEditorView uses for CollabRoom).
      rooms: rooms.map((r) => ({
        strategy: r.strategy,
        room: r.room as unknown as AgreementRoom,
      })),
      onActivate: (strategy, _room, peerId) => {
        const entry = rooms.find((r) => r.strategy === strategy);
        if (entry) onActivate(entry, peerId);
      },
    });
  }

  private async createReceiverSequential(
    roomId: string,
    config: RoomConfig,
    adapters: StrategyAdapter[],
  ): Promise<{ roomId: string }> {
    this.strategyAttempts.value = adapters.map((a) => ({
      strategy: a.name,
      status: "connecting" as const,
    }));

    for (let i = 0; i < adapters.length; i++) {
      const adapter = adapters[i];

      this.strategyAttempts.value = adapters.map((a, j) => ({
        strategy: a.name,
        status: j < i ? "failed" : j === i ? "connecting" : ("connecting" as const),
      }));

      try {
        const joinConfig = buildJoinConfig(config, adapter, roomId);
        const room = adapter.joinRoom(joinConfig, roomId, (d) => this.handleJoinError(d));
        this.activeRooms = [{ strategy: adapter.name, room }];

        console.log("[webrtc] Receiver trying strategy:", adapter.name, "room:", roomId);

        const connected = await new Promise<{ peerId: string } | null>((resolve) => {
          const timeout = setTimeout(() => {
            room.leave();
            resolve(null);
          }, STRATEGY_TIMEOUT);

          room.onPeerJoin((peerId) => {
            clearTimeout(timeout);
            resolve({ peerId });
          });
        });

        if (connected) {
          this.room = room;
          this.activeStrategy.value = adapter.name;
          this.remotePeerId = connected.peerId;
          this.state.value = "confirming";
          this.deriveConfirmationCode();
          this.peerOnline.value = true;
          this.setupCollabSignal(room);

          this.strategyAttempts.value = adapters.map((a, j) => ({
            strategy: a.name,
            status: j < i ? "failed" : j === i ? "connected" : "cancelled",
          }));

          room.onPeerLeave((peerId) => this.handlePeerLeave(room, peerId));

          this.setupReceiverActions(room);
          return { roomId };
        }
      } catch (err) {
        console.warn(`[webrtc] Strategy ${adapter.name} failed:`, err);
      }

      this.strategyAttempts.value = this.strategyAttempts.value.map((a, j) =>
        j === i ? { ...a, status: "failed" as const } : a,
      );
    }

    this.state.value = "error";
    this.error.value = "All signaling strategies failed to connect.";
    this.activeRooms = [];
    throw new Error("All signaling strategies failed");
  }

  private setupReceiverActions(room: Room): void {
    const [, getFile, onFileProgress] = room.makeAction<ArrayBuffer>("file");
    const [, getMetadata] = room.makeAction<string>("metadata");
    const [, getBatch] = room.makeAction<string>("batch");

    let metadata: TransferMetadata | null = null;
    let startTime = 0;
    let batchMeta: BatchMetadata | null = null;
    let receivedCount = 0;

    getBatch((raw) => {
      batchMeta = JSON.parse(raw) as BatchMetadata;
      console.log("[webrtc] Batch started:", batchMeta);
      this.onBatchStartedCb?.(batchMeta);
    });

    getMetadata((raw) => {
      const meta = JSON.parse(raw) as TransferMetadata;
      console.log("[webrtc] Received file metadata:", meta);
      metadata = meta;
      startTime = Date.now();
      this.state.value = "transferring";
    });

    onFileProgress((percent, _peerId) => {
      if (metadata && this.onProgressCb) {
        const elapsed = Date.now() - startTime;
        const bytesSent = Math.round(percent * metadata.fileSize);
        this.onProgressCb({
          bytesSent,
          totalBytes: metadata.fileSize,
          speedBytesPerSec: elapsed > 0 ? (bytesSent / elapsed) * 1000 : 0,
          elapsedMs: elapsed,
        });
      }
    });

    getFile((data, _peerId) => {
      console.log("[webrtc] Received file data, size:", (data as ArrayBuffer).byteLength);
      if (metadata && this.onFileReceivedCb) {
        this.onFileReceivedCb(metadata, new Uint8Array(data as ArrayBuffer));
        receivedCount++;

        if (batchMeta && receivedCount < batchMeta.totalFiles) {
          metadata = null;
        } else {
          this.state.value = "complete";
          if (batchMeta) {
            this.onBatchCompleteCb?.();
          }
        }
      }
    });
  }

  async connectToRoom(
    roomId: string,
    config: RoomConfig = DEFAULT_ROOM_CONFIG,
  ): Promise<void> {
    this.state.value = "connecting";

    const strategies = config.strategies ?? ALL_STRATEGIES;
    const adapters = await Promise.all(strategies.map(getAdapter));
    const mode = config.connectionMode ?? "parallel";

    if (mode === "sequential") {
      return this.connectSequential(roomId, config, adapters);
    }
    return this.connectParallel(roomId, config, adapters);
  }

  private connectParallel(
    roomId: string,
    config: RoomConfig,
    adapters: StrategyAdapter[],
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const rooms: { strategy: StrategyName; room: Room }[] = [];
      for (const adapter of adapters) {
        try {
          const joinConfig = buildJoinConfig(config, adapter, roomId);
          const room = adapter.joinRoom(joinConfig, roomId, (d) => this.handleJoinError(d));
          rooms.push({ strategy: adapter.name, room });
        } catch (err) {
          console.warn(`[webrtc] Strategy ${adapter.name} failed to join:`, err);
        }
      }

      if (rooms.length === 0) {
        this.state.value = "error";
        this.error.value = "All signaling strategies failed to initialize.";
        this.diagnosis.value = classifyFailure({ outcome: "no-strategy-initialized" });
        reject(new Error("All signaling strategies failed"));
        return;
      }

      this.activeRooms = rooms;
      this.strategyAttempts.value = rooms.map((r) => ({
        strategy: r.strategy,
        status: "connecting" as const,
      }));

      console.log(
        "[webrtc] Sender joined room:",
        roomId,
        "selfId:",
        selfId,
        "strategies:",
        rooms.map((r) => r.strategy),
      );

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        for (const { room } of rooms) room.leave();
        this.activeRooms = [];
        this.state.value = "error";
        this.error.value =
          "Connection timed out. Make sure the receiver is still waiting and try again.";
        this.strategyAttempts.value = rooms.map((r) => ({
          strategy: r.strategy,
          status: "failed",
        }));
        // Nobody ever joined. Probe the local ICE path so the user is told which
        // thing failed instead of "the receiver may not be waiting" — which is
        // actively misleading when the real cause is a network needing a relay.
        void this.diagnosePeerNeverJoined(config, adapters[0], roomId);
        reject(new Error("Connection timed out"));
      }, 30_000);

      this.agreement = this.startAgreement(rooms, (entry, peerId) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.adoptStrategy(entry, peerId, rooms);
        resolve();
      });
    });
  }

  private async connectSequential(
    roomId: string,
    config: RoomConfig,
    adapters: StrategyAdapter[],
  ): Promise<void> {
    this.strategyAttempts.value = adapters.map((a) => ({
      strategy: a.name,
      status: "connecting" as const,
    }));

    for (let i = 0; i < adapters.length; i++) {
      const adapter = adapters[i];

      this.strategyAttempts.value = adapters.map((a, j) => ({
        strategy: a.name,
        status: j < i ? "failed" : j === i ? "connecting" : ("connecting" as const),
      }));

      try {
        const joinConfig = buildJoinConfig(config, adapter, roomId);
        const room = adapter.joinRoom(joinConfig, roomId, (d) => this.handleJoinError(d));
        this.activeRooms = [{ strategy: adapter.name, room }];

        console.log("[webrtc] Sender trying strategy:", adapter.name, "room:", roomId);

        const connected = await new Promise<{ peerId: string } | null>((resolve) => {
          const timeout = setTimeout(() => {
            room.leave();
            resolve(null);
          }, STRATEGY_TIMEOUT);

          room.onPeerJoin((peerId) => {
            clearTimeout(timeout);
            resolve({ peerId });
          });
        });

        if (connected) {
          this.room = room;
          this.activeStrategy.value = adapter.name;
          this.remotePeerId = connected.peerId;
          this.state.value = "confirming";
          this.deriveConfirmationCode();
          this.peerOnline.value = true;
          this.setupCollabSignal(room);

          this.strategyAttempts.value = adapters.map((a, j) => ({
            strategy: a.name,
            status: j < i ? "failed" : j === i ? "connected" : "cancelled",
          }));

          room.onPeerLeave((peerId) => this.handlePeerLeave(room, peerId));

          return;
        }
      } catch (err) {
        console.warn(`[webrtc] Strategy ${adapter.name} failed:`, err);
      }

      this.strategyAttempts.value = this.strategyAttempts.value.map((a, j) =>
        j === i ? { ...a, status: "failed" as const } : a,
      );
    }

    this.activeRooms = [];
    this.state.value = "error";
    this.error.value =
      "Connection timed out. Make sure the receiver is still waiting and try again.";
    this.strategyAttempts.value = adapters.map((a) => ({
      strategy: a.name,
      status: "failed",
    }));
    // Same failure as the parallel timeout: nobody ever joined, on any strategy.
    void this.diagnosePeerNeverJoined(config, adapters[0], roomId);
    throw new Error("All signaling strategies failed");
  }

  private deriveConfirmationCode(): void {
    const ids = [selfId, this.remotePeerId].sort();
    const combined = `${ids[0]}:${ids[1]}`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(combined);
    let hash = 0;
    for (const b of bytes) {
      hash = ((hash << 5) - hash + b) | 0;
    }
    this.confirmationCode.value = String(Math.abs(hash) % 10000).padStart(
      4,
      "0",
    );
  }

  getConfirmationCode(): string {
    return this.confirmationCode.value;
  }

  async sendFile(
    file: File,
    onProgress: (p: TransferProgress) => void,
  ): Promise<void> {
    if (!this.room) throw new Error("Not connected");

    this.state.value = "transferring";

    const buffer = await file.arrayBuffer();
    const fileData = new Uint8Array(buffer);
    const sha256 = await hashSha256(fileData);

    const metadata: TransferMetadata = {
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      sha256: toHex(sha256),
    };

    const [sendMetadata] = this.room.makeAction<string>("metadata");
    const [sendFile] = this.room.makeAction<ArrayBuffer>("file");

    await sendMetadata(JSON.stringify(metadata));
    console.log("[webrtc] Sent metadata:", metadata);

    const startTime = Date.now();

    await sendFile(buffer, null, null, (percent, _peerId) => {
      const elapsed = Date.now() - startTime;
      const bytesSent = Math.round(percent * file.size);
      onProgress({
        bytesSent,
        totalBytes: file.size,
        speedBytesPerSec: elapsed > 0 ? (bytesSent / elapsed) * 1000 : 0,
        elapsedMs: elapsed,
      });
    });

    this.state.value = "complete";
  }

  async sendFiles(
    files: File[],
    onProgress: (p: MultiFileProgress) => void,
  ): Promise<void> {
    if (!this.room) throw new Error("Not connected");

    this.state.value = "transferring";

    const [sendBatch] = this.room.makeAction<string>("batch");
    const [sendMetadata] = this.room.makeAction<string>("metadata");
    const [sendFile] = this.room.makeAction<ArrayBuffer>("file");

    const batch: BatchMetadata = {
      totalFiles: files.length,
      filenames: files.map((f) => f.name),
    };
    await sendBatch(JSON.stringify(batch));
    console.log("[webrtc] Sent batch metadata:", batch);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = await file.arrayBuffer();
      const fileData = new Uint8Array(buffer);
      const sha256 = await hashSha256(fileData);

      const metadata: TransferMetadata = {
        filename: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        sha256: toHex(sha256),
      };

      await sendMetadata(JSON.stringify(metadata));
      console.log(`[webrtc] Sent metadata for file ${i + 1}/${files.length}:`, metadata);

      const startTime = Date.now();

      await sendFile(buffer, null, null, (percent, _peerId) => {
        const elapsed = Date.now() - startTime;
        const bytesSent = Math.round(percent * file.size);
        onProgress({
          currentFileIndex: i,
          totalFiles: files.length,
          currentFileProgress: {
            bytesSent,
            totalBytes: file.size,
            speedBytesPerSec: elapsed > 0 ? (bytesSent / elapsed) * 1000 : 0,
            elapsedMs: elapsed,
          },
        });
      });

      console.log(`[webrtc] File ${i + 1}/${files.length} sent`);
    }

    this.state.value = "complete";
  }

  onFileReceived(
    cb: (metadata: TransferMetadata, data: Uint8Array) => void,
  ): void {
    this.onFileReceivedCb = cb;
  }

  onProgress(cb: (p: TransferProgress) => void): void {
    this.onProgressCb = cb;
  }

  onBatchStarted(cb: (batch: BatchMetadata) => void): void {
    this.onBatchStartedCb = cb;
  }

  onBatchComplete(cb: () => void): void {
    this.onBatchCompleteCb = cb;
  }

  /** Apply the peer-leave policy for the current connection state. */
  /**
   * Cheap safety net, not a real detector. Trystero raises this only when an
   * offer/answer fails to decrypt (`strategy.js:104-110`), i.e. the two peers used
   * different passwords. QRShare sets `password: roomId` and trystero derives the
   * room topic from that same `roomId` (`strategy.js:39-42`), so two peers in the
   * same room always derive the same key — this is expected to be unreachable here.
   */
  private handleJoinError(details: JoinErrorDetails): void {
    console.warn("[webrtc] Join error:", details);
    this.diagnosis.value = classifyFailure({ outcome: "wrong-room-id" });
  }

  private handlePeerLeave(room: Room, peerId: string): void {
    if (this.room !== room) return;
    console.log("[webrtc] Peer left:", peerId);
    this.stopPeerSampling();
    const { nextState, peerOffline } = resolvePeerLeave(this.state.value);
    if (peerOffline) this.peerOnline.value = false;
    if (nextState === "error") {
      this.state.value = "error";
      this.error.value = "Peer disconnected";
      this.diagnosis.value = classifyFailure({
        outcome: "peer-left",
        lastPeerConnectionState: this.lastPeerConnectionState,
        lastIceConnectionState: this.lastIceConnectionState,
      });
    }
  }

  /**
   * Poll the live RTCPeerConnection so `classifyFailure` has an input when the
   * peer eventually goes away. Trystero hands us the real pc via `getPeers()`
   * (`index.d.ts:66`, `room.js:349`), but only while the channel is open.
   */
  private startPeerSampling(room: Room, peerId: string): void {
    this.stopPeerSampling();
    this.lastPeerConnectionState = undefined;
    this.lastIceConnectionState = undefined;
    const sample = () => {
      const pc = room.getPeers()[peerId];
      if (!pc) return;
      if (pc.connectionState !== "closed") {
        this.lastPeerConnectionState = pc.connectionState;
      }
      if (pc.iceConnectionState !== "closed") {
        this.lastIceConnectionState = pc.iceConnectionState;
      }
    };
    sample();
    this.sampleTimer = setInterval(sample, PEER_SAMPLE_INTERVAL_MS);
  }

  private stopPeerSampling(): void {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer);
    this.sampleTimer = null;
  }

  /**
   * Nobody ever joined. Ambiguous by construction, so narrow it with a local ICE
   * probe over exactly the servers a real connection would have used
   * ([REQ-RELY-043]) — never speculatively, only after a failure ([REQ-RELY-047]).
   */
  private async diagnosePeerNeverJoined(
    config: RoomConfig,
    adapter: StrategyAdapter | undefined,
    roomId: string,
  ): Promise<void> {
    let probe: IceProbeResult | undefined;
    try {
      if (adapter) {
        const iceServers = buildJoinConfig(config, adapter, roomId).rtcConfig?.iceServers;
        if (iceServers) probe = await probeIce(iceServers);
      }
    } catch (err) {
      // Best effort: an unavailable probe just leaves the diagnosis ambiguous,
      // which classifyFailure already handles honestly.
      console.warn("[webrtc] ICE probe failed:", err);
    }
    this.diagnosis.value = classifyFailure({ outcome: "peer-never-joined", probe });
  }

  /**
   * Register the `collab-go` action so either peer can signal that it has started
   * a collaborative session; the remote peer converges onto the shared editor
   * (REQ-COLLAB-005).
   */
  private setupCollabSignal(room: Room): void {
    const [send, get] = room.makeAction<string>("collab-go");
    this.sendCollabStart = () => {
      void send("go");
    };
    get(() => {
      this.collabRequested.value = true;
    });
  }

  /**
   * Enter the live collaborative session: keep the room open and transition to the
   * `editing` state (never `complete`), signaling the peer to join the shared
   * editor (REQ-COLLAB-004, REQ-COLLAB-005).
   */
  startCollab(): void {
    this.sendCollabStart?.();
    this.state.value = "editing";
  }

  /** Transition to `editing` without re-signaling the peer (used on the joining side). */
  enterEditing(): void {
    this.state.value = "editing";
  }

  /** Expose the live trystero room so a CollabSession can reuse the connection. */
  getRoom(): Room | null {
    return this.room;
  }

  /** This peer's stable site id (trystero selfId). */
  getSelfId(): string {
    return selfId;
  }

  disconnect(): void {
    this.agreement?.destroy();
    this.agreement = null;
    this.stopPeerSampling();
    for (const { room } of this.activeRooms) {
      room.leave();
    }
    this.activeRooms = [];
    this.room = null;
    this.state.value = "idle";
    this.activeStrategy.value = null;
    this.strategyAttempts.value = [];
    this.confirmationCode.value = "";
    this.error.value = null;
  }
}
