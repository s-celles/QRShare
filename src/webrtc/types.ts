export interface TurnServerConfig {
  urls: string;
  username: string;
  credential: string;
}

export interface PeerConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  stunServers: string[];
  turnServers: TurnServerConfig[];
}

export interface TransferMetadata {
  filename: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  totalChunks: number;
}

export interface TransferProgress {
  bytesSent: number;
  totalBytes: number;
  speedBytesPerSec: number;
  elapsedMs: number;
}

export type ConnectionState =
  | "idle"
  | "waiting"
  | "connecting"
  | "confirming"
  | "transferring"
  | "complete"
  | "error";

export const DEFAULT_PEER_CONFIG: PeerConfig = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
  stunServers: [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
  ],
  turnServers: [
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turns:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

export const CHUNK_SIZE = 64 * 1024; // 64 KB
export const BACKPRESSURE_HIGH = 1024 * 1024; // 1 MB
export const BACKPRESSURE_LOW = 256 * 1024; // 256 KB
