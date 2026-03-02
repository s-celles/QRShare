export interface RoomConfig {
  appId: string;
  relayRedundancy: number;
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
};
