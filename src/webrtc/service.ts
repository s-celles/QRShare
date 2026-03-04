import { signal } from "@preact/signals";
import { selfId } from "trystero/nostr";
import type { Room } from "trystero";
import { hashSha256 } from "@/crypto/hash";
import { getAdapter, ALL_STRATEGIES, type StrategyName, type StrategyAdapter, type JoinRoomConfig } from "./strategies";
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

function buildJoinConfig(config: RoomConfig, adapter: StrategyAdapter, roomId: string): JoinRoomConfig {
  const relayUrls = config.relayUrls?.[adapter.name];
  const joinConfig: JoinRoomConfig = {
    appId: config.appId,
    password: roomId,
    relayRedundancy: config.relayRedundancy,
    relayUrls: relayUrls?.length ? relayUrls : undefined,
  };

  const iceServers = config.iceServers ?? [];
  if (iceServers.length > 0) {
    const getUrl = (s: { urls: string | string[] }) =>
      Array.isArray(s.urls) ? s.urls[0] : s.urls;
    const stunServers = iceServers.filter((s) => getUrl(s)?.startsWith("stun:"));
    const turnServers = iceServers.filter((s) => {
      const u = getUrl(s);
      return u?.startsWith("turn:") || u?.startsWith("turns:");
    });

    if (stunServers.length > 0 || turnServers.length > 0) {
      joinConfig.rtcConfig = {
        iceServers: stunServers.map((s) => ({ urls: s.urls })),
      };
    }
    if (turnServers.length > 0) {
      joinConfig.turnConfig = turnServers.map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      }));
    }
  }

  return joinConfig;
}

export class WebRTCService {
  readonly state = signal<ConnectionState>("idle");
  readonly confirmationCode = signal("");
  readonly error = signal<string | null>(null);
  readonly activeStrategy = signal<StrategyName | null>(null);
  readonly strategyAttempts = signal<StrategyAttemptStatus[]>([]);

  private room: Room | null = null;
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
  ): Promise<{ roomId: string }> {
    const roomId = generateRoomId();
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
        const room = adapter.joinRoom(joinConfig, roomId);
        rooms.push({ strategy: adapter.name, room });
      } catch (err) {
        console.warn(`[webrtc] Strategy ${adapter.name} failed to join:`, err);
      }
    }

    if (rooms.length === 0) {
      this.state.value = "error";
      this.error.value = "All signaling strategies failed to initialize.";
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

    let settled = false;

    for (const { strategy, room } of rooms) {
      room.onPeerJoin((peerId) => {
        if (settled) return;
        settled = true;

        console.log("[webrtc] Peer joined via", strategy, ":", peerId);
        this.room = room;
        this.activeStrategy.value = strategy;
        this.remotePeerId = peerId;
        this.state.value = "confirming";
        this.deriveConfirmationCode();

        this.strategyAttempts.value = rooms.map((r) => ({
          strategy: r.strategy,
          status: r.strategy === strategy ? "connected" : "cancelled",
        }));

        for (const other of rooms) {
          if (other.strategy !== strategy) {
            other.room.leave();
          }
        }
        this.activeRooms = [{ strategy, room }];

        this.setupReceiverActions(room);
      });

      room.onPeerLeave((peerId) => {
        if (this.room === room && this.state.value !== "complete") {
          console.log("[webrtc] Peer left:", peerId);
          this.state.value = "error";
          this.error.value = "Peer disconnected";
        }
      });
    }

    return { roomId };
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
        const room = adapter.joinRoom(joinConfig, roomId);
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

          this.strategyAttempts.value = adapters.map((a, j) => ({
            strategy: a.name,
            status: j < i ? "failed" : j === i ? "connected" : "cancelled",
          }));

          room.onPeerLeave((peerId) => {
            if (this.room === room && this.state.value !== "complete") {
              console.log("[webrtc] Peer left:", peerId);
              this.state.value = "error";
              this.error.value = "Peer disconnected";
            }
          });

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
          const room = adapter.joinRoom(joinConfig, roomId);
          rooms.push({ strategy: adapter.name, room });
        } catch (err) {
          console.warn(`[webrtc] Strategy ${adapter.name} failed to join:`, err);
        }
      }

      if (rooms.length === 0) {
        this.state.value = "error";
        this.error.value = "All signaling strategies failed to initialize.";
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
        reject(new Error("Connection timed out"));
      }, 30_000);

      for (const { strategy, room } of rooms) {
        room.onPeerJoin((peerId) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          console.log("[webrtc] Connected to peer via", strategy, ":", peerId);
          this.room = room;
          this.activeStrategy.value = strategy;
          this.remotePeerId = peerId;
          this.state.value = "confirming";
          this.deriveConfirmationCode();

          this.strategyAttempts.value = rooms.map((r) => ({
            strategy: r.strategy,
            status: r.strategy === strategy ? "connected" : "cancelled",
          }));

          for (const other of rooms) {
            if (other.strategy !== strategy) {
              other.room.leave();
            }
          }
          this.activeRooms = [{ strategy, room }];

          resolve();
        });

        room.onPeerLeave((peerId) => {
          if (this.room === room && this.state.value !== "complete") {
            console.log("[webrtc] Peer left:", peerId);
            this.state.value = "error";
            this.error.value = "Peer disconnected";
          }
        });
      }
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
        const room = adapter.joinRoom(joinConfig, roomId);
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

          this.strategyAttempts.value = adapters.map((a, j) => ({
            strategy: a.name,
            status: j < i ? "failed" : j === i ? "connected" : "cancelled",
          }));

          room.onPeerLeave((peerId) => {
            if (this.room === room && this.state.value !== "complete") {
              console.log("[webrtc] Peer left:", peerId);
              this.state.value = "error";
              this.error.value = "Peer disconnected";
            }
          });

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

  disconnect(): void {
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
