import type { StrategyName } from "./strategies";

export type ConnectionMode = "parallel" | "sequential";

export interface RoomConfig {
  appId: string;
  relayRedundancy: number;
  strategies?: StrategyName[];
  relayUrls?: Partial<Record<StrategyName, string[]>>;
  connectionMode?: ConnectionMode;
}

export interface TransferMetadata {
  filename: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
}

export interface TransferProgress {
  bytesSent: number;
  totalBytes: number;
  speedBytesPerSec: number;
  elapsedMs: number;
}

export interface BatchMetadata {
  totalFiles: number;
  filenames: string[];
}

export interface MultiFileProgress {
  currentFileIndex: number;
  totalFiles: number;
  currentFileProgress: TransferProgress;
}

export interface StrategyAttemptStatus {
  strategy: StrategyName;
  status: "connecting" | "connected" | "failed" | "cancelled";
}

export type ConnectionState =
  | "idle"
  | "waiting"
  | "connecting"
  | "confirming"
  | "transferring"
  | "complete"
  | "error";

export const ROOM_ID_LENGTH = 6;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  appId: "qrshare-webrtc-v1",
  relayRedundancy: 3,
  strategies: ["nostr", "torrent", "mqtt"],
};
