import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ROOM_CONFIG,
  ROOM_ID_LENGTH,
  type BatchMetadata,
  type MultiFileProgress,
} from "@/webrtc/types";

describe("WebRTC types", () => {
  it("has sensible default room config", () => {
    expect(DEFAULT_ROOM_CONFIG.appId).toBe("qrshare-webrtc-v1");
    expect(DEFAULT_ROOM_CONFIG.relayRedundancy).toBe(3);
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
