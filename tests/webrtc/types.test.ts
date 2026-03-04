import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ROOM_CONFIG,
  ROOM_ID_LENGTH,
  type RoomConfig,
  type ConnectionMode,
  type BatchMetadata,
  type MultiFileProgress,
  type StrategyAttemptStatus,
} from "@/webrtc/types";

describe("WebRTC types", () => {
  it("has sensible default room config", () => {
    expect(DEFAULT_ROOM_CONFIG.appId).toBe("qrshare-webrtc-v1");
    expect(DEFAULT_ROOM_CONFIG.relayRedundancy).toBe(3);
    expect(DEFAULT_ROOM_CONFIG.strategies).toEqual(["nostr", "torrent", "mqtt"]);
  });

  it("room ID length is 6", () => {
    expect(ROOM_ID_LENGTH).toBe(6);
  });

  it("BatchMetadata has correct shape", () => {
    const batch: BatchMetadata = {
      totalFiles: 3,
      filenames: ["a.txt", "b.txt", "c.txt"],
    };
    expect(batch.totalFiles).toBe(3);
    expect(batch.filenames).toHaveLength(3);
  });

  it("StrategyAttemptStatus has correct shape", () => {
    const attempt: StrategyAttemptStatus = {
      strategy: "nostr",
      status: "connecting",
    };
    expect(attempt.strategy).toBe("nostr");
    expect(attempt.status).toBe("connecting");
  });

  it("RoomConfig supports optional relayUrls", () => {
    const config: RoomConfig = {
      appId: "test",
      relayRedundancy: 1,
      relayUrls: { torrent: ["wss://example.com"] },
    };
    expect(config.relayUrls?.torrent).toEqual(["wss://example.com"]);
  });

  it("RoomConfig supports connectionMode", () => {
    const config: RoomConfig = {
      appId: "test",
      relayRedundancy: 1,
      connectionMode: "sequential",
    };
    expect(config.connectionMode).toBe("sequential");
  });

  it("ConnectionMode type accepts valid values", () => {
    const parallel: ConnectionMode = "parallel";
    const sequential: ConnectionMode = "sequential";
    expect(parallel).toBe("parallel");
    expect(sequential).toBe("sequential");
  });

  it("MultiFileProgress has correct shape", () => {
    const progress: MultiFileProgress = {
      currentFileIndex: 1,
      totalFiles: 3,
      currentFileProgress: {
        bytesSent: 500,
        totalBytes: 1000,
        speedBytesPerSec: 500,
        elapsedMs: 1000,
      },
    };
    expect(progress.currentFileIndex).toBe(1);
    expect(progress.totalFiles).toBe(3);
    expect(progress.currentFileProgress.bytesSent).toBe(500);
  });
});
