import { signal } from "@preact/signals";
import { joinRoom, selfId } from "trystero/nostr";
import type { Room } from "trystero";
import { hashSha256 } from "@/crypto/hash";
import {
  type RoomConfig,
  type TransferMetadata,
  type TransferProgress,
  type ConnectionState,
  DEFAULT_ROOM_CONFIG,
  ROOM_ID_LENGTH,
} from "./types";

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

export class WebRTCService {
  readonly state = signal<ConnectionState>("idle");
  readonly confirmationCode = signal("");
  readonly error = signal<string | null>(null);

  private room: Room | null = null;
  private remotePeerId = "";
  private onFileReceivedCb:
    | ((metadata: TransferMetadata, data: Uint8Array) => void)
    | null = null;
  private onProgressCb: ((p: TransferProgress) => void) | null = null;

  async createReceiver(
    config: RoomConfig = DEFAULT_ROOM_CONFIG,
  ): Promise<{ roomId: string }> {
    const roomId = generateRoomId();
    this.state.value = "waiting";

    this.room = joinRoom(
      { appId: config.appId, password: roomId, relayRedundancy: config.relayRedundancy },
      roomId,
    );

    console.log("[webrtc] Receiver joined room:", roomId, "selfId:", selfId);

    // Set up file receiving via makeAction
    const [, getFile, onFileProgress] = this.room.makeAction<ArrayBuffer>("file");
    const [, getMetadata] = this.room.makeAction<string>("metadata");

    let metadata: TransferMetadata | null = null;
    let startTime = 0;

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
        this.state.value = "complete";
        this.onFileReceivedCb(metadata, new Uint8Array(data as ArrayBuffer));
      }
    });

    this.room.onPeerJoin((peerId) => {
      console.log("[webrtc] Peer joined:", peerId);
      this.remotePeerId = peerId;
      this.state.value = "confirming";
      this.deriveConfirmationCode();
    });

    this.room.onPeerLeave((peerId) => {
      console.log("[webrtc] Peer left:", peerId);
      if (this.state.value !== "complete") {
        this.state.value = "error";
        this.error.value = "Peer disconnected";
      }
    });

    return { roomId };
  }

  async connectToRoom(
    roomId: string,
    config: RoomConfig = DEFAULT_ROOM_CONFIG,
  ): Promise<void> {
    this.state.value = "connecting";

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error("[webrtc] Connection timed out after 30s");
        this.state.value = "error";
        this.error.value = "Connection timed out. Make sure the receiver is still waiting and try again.";
        reject(new Error("Connection timed out"));
      }, 30_000);

      try {
        this.room = joinRoom(
          { appId: config.appId, password: roomId, relayRedundancy: config.relayRedundancy },
          roomId,
        );

        console.log("[webrtc] Sender joined room:", roomId, "selfId:", selfId);

        this.room.onPeerJoin((peerId) => {
          clearTimeout(timeout);
          console.log("[webrtc] Connected to peer:", peerId);
          this.remotePeerId = peerId;
          this.state.value = "confirming";
          this.deriveConfirmationCode();
          resolve();
        });

        this.room.onPeerLeave((peerId) => {
          console.log("[webrtc] Peer left:", peerId);
          if (this.state.value !== "complete") {
            this.state.value = "error";
            this.error.value = "Peer disconnected";
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        this.state.value = "error";
        this.error.value = err instanceof Error ? err.message : String(err);
        reject(err);
      }
    });
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

    // Send metadata first as JSON string
    await sendMetadata(JSON.stringify(metadata));
    console.log("[webrtc] Sent metadata:", metadata);

    const startTime = Date.now();

    // Send file with progress tracking
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

  onFileReceived(
    cb: (metadata: TransferMetadata, data: Uint8Array) => void,
  ): void {
    this.onFileReceivedCb = cb;
  }

  onProgress(cb: (p: TransferProgress) => void): void {
    this.onProgressCb = cb;
  }

  disconnect(): void {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.state.value = "idle";
    this.confirmationCode.value = "";
    this.error.value = null;
  }
}
