import { signal } from "@preact/signals";
import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { hashSha256 } from "@/crypto/hash";
import {
  type PeerConfig,
  type TransferMetadata,
  type TransferProgress,
  type ConnectionState,
  DEFAULT_PEER_CONFIG,
  CHUNK_SIZE,
  BACKPRESSURE_HIGH,
} from "./types";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class WebRTCService {
  readonly state = signal<ConnectionState>("idle");
  readonly confirmationCode = signal("");
  readonly error = signal<string | null>(null);

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private peerId = "";
  private onFileReceivedCb:
    | ((metadata: TransferMetadata, data: Uint8Array) => void)
    | null = null;
  private onProgressCb: ((p: TransferProgress) => void) | null = null;

  async createReceiver(
    config: PeerConfig = DEFAULT_PEER_CONFIG,
  ): Promise<{ peerId: string }> {
    this.peerId = crypto.randomUUID();
    this.state.value = "waiting";

    return new Promise<{ peerId: string }>((resolve, reject) => {
      const iceServers: Array<{ urls: string; username?: string; credential?: string }> = config.stunServers.map((url) => ({ urls: url }));
      if (config.turnServer) {
        iceServers.push({
          urls: config.turnServer.urls,
          username: config.turnServer.username,
          credential: config.turnServer.credential,
        });
      }

      this.peer = new Peer(this.peerId, {
        host: config.host,
        port: config.port,
        path: config.path,
        secure: config.secure,
        config: { iceServers },
      });

      this.peer.on("open", () => {
        resolve({ peerId: this.peerId });
      });

      this.peer.on("connection", (conn) => {
        this.conn = conn;
        this.state.value = "connecting";
        this.setupReceiverConnection(conn);
      });

      this.peer.on("error", (err) => {
        this.state.value = "error";
        this.error.value = `Signaling error: ${err.message}. Try QR mode as an alternative.`;
        reject(err);
      });
    });
  }

  async connectToReceiver(
    peerId: string,
    config: PeerConfig = DEFAULT_PEER_CONFIG,
  ): Promise<void> {
    this.peerId = crypto.randomUUID();
    this.state.value = "connecting";

    return new Promise<void>((resolve, reject) => {
      const iceServers: Array<{ urls: string; username?: string; credential?: string }> = config.stunServers.map((url) => ({ urls: url }));
      if (config.turnServer) {
        iceServers.push({
          urls: config.turnServer.urls,
          username: config.turnServer.username,
          credential: config.turnServer.credential,
        });
      }

      this.peer = new Peer(this.peerId, {
        host: config.host,
        port: config.port,
        path: config.path,
        secure: config.secure,
        config: { iceServers },
      });

      this.peer.on("open", () => {
        const conn = this.peer!.connect(peerId, { reliable: true });
        this.conn = conn;

        conn.on("open", () => {
          this.state.value = "confirming";
          this.deriveConfirmationCode();
          resolve();
        });

        conn.on("error", (err) => {
          this.state.value = "error";
          this.error.value = err.message;
          reject(err);
        });
      });

      this.peer.on("error", (err) => {
        this.state.value = "error";
        this.error.value = `Signaling error: ${err.message}. Try QR mode as an alternative.`;
        reject(err);
      });
    });
  }

  private setupReceiverConnection(conn: DataConnection): void {
    conn.on("open", () => {
      this.state.value = "confirming";
      this.deriveConfirmationCode();
    });

    let metadata: TransferMetadata | null = null;
    const chunks: ArrayBuffer[] = [];
    let receivedBytes = 0;
    const startTime = Date.now();

    conn.on("data", (data: unknown) => {
      if (!metadata && typeof data === "string") {
        metadata = JSON.parse(data) as TransferMetadata;
        this.state.value = "transferring";
        return;
      }

      // PeerJS binary serialization may deliver as ArrayBuffer, Uint8Array, or Blob
      let chunk: ArrayBuffer | null = null;
      if (data instanceof ArrayBuffer) {
        chunk = data;
      } else if (data instanceof Uint8Array) {
        chunk = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      }

      if (metadata && chunk) {
        chunks.push(chunk);
        receivedBytes += chunk.byteLength;

        if (this.onProgressCb) {
          const elapsed = Date.now() - startTime;
          this.onProgressCb({
            bytesSent: receivedBytes,
            totalBytes: metadata.fileSize,
            speedBytesPerSec:
              elapsed > 0 ? (receivedBytes / elapsed) * 1000 : 0,
            elapsedMs: elapsed,
          });
        }

        if (receivedBytes >= metadata.fileSize) {
          const result = new Uint8Array(receivedBytes);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }

          this.state.value = "complete";
          if (this.onFileReceivedCb) {
            this.onFileReceivedCb(metadata, result);
          }
        }
      }
    });

    conn.on("error", (err) => {
      this.state.value = "error";
      this.error.value = err.message;
    });

    conn.on("close", () => {
      if (this.state.value !== "complete") {
        this.state.value = "error";
        this.error.value = "Connection closed during transfer";
      }
    });
  }

  private deriveConfirmationCode(): void {
    // Derive 4-digit code from peer IDs — sort to ensure same order on both sides
    const ids = [this.peerId, this.conn?.peer || ""].sort();
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
    if (!this.conn) throw new Error("Not connected");

    this.state.value = "transferring";

    const buffer = await file.arrayBuffer();
    const fileData = new Uint8Array(buffer);
    const sha256 = await hashSha256(fileData);

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const metadata: TransferMetadata = {
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      sha256: toHex(sha256),
      totalChunks,
    };

    // Send metadata as JSON
    this.conn.send(JSON.stringify(metadata));

    const startTime = Date.now();
    let sentBytes = 0;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = buffer.slice(start, end);

      // Backpressure: wait if buffer is too full
      while (
        this.conn.dataChannel &&
        this.conn.dataChannel.bufferedAmount > BACKPRESSURE_HIGH
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      this.conn.send(chunk);
      sentBytes += chunk.byteLength;

      const elapsed = Date.now() - startTime;
      onProgress({
        bytesSent: sentBytes,
        totalBytes: file.size,
        speedBytesPerSec: elapsed > 0 ? (sentBytes / elapsed) * 1000 : 0,
        elapsedMs: elapsed,
      });
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

  disconnect(): void {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.state.value = "idle";
    this.confirmationCode.value = "";
    this.error.value = null;
  }
}
