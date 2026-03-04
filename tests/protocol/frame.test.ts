import { describe, expect, it } from "bun:test";
import {
  serializeFrame,
  parseFrame,
  getFrameOverhead,
  PROTOCOL_VERSION,
  BASE_HEADER_SIZE,
  type Frame,
} from "@/protocol/frame";

describe("FrameProtocol", () => {
  const sampleFrame: Frame = {
    version: PROTOCOL_VERSION,
    flags: 0x00,
    metadataHash: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
    sourceBlockCount: 100,
    blockSize: 1024,
    compressedSize: 50000,
    compressionId: 0x01,
    symbolId: 42,
    filename: "sample.bin",
    fileSize: 60000,
    sha256: new Uint8Array(32).fill(0xCC),
    payload: new Uint8Array([1, 2, 3, 4, 5]),
  };

  describe("serializeFrame / parseFrame roundtrip", () => {
    it("roundtrips a data frame with embedded metadata", () => {
      const serialized = serializeFrame(sampleFrame);
      const result = parseFrame(serialized);
      expect(result.kind).toBe("data");
      if (result.kind === "data") {
        expect(result.frame.version).toBe(PROTOCOL_VERSION);
        expect(result.frame.flags).toBe(0x00);
        expect(result.frame.metadataHash).toEqual(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
        expect(result.frame.sourceBlockCount).toBe(100);
        expect(result.frame.blockSize).toBe(1024);
        expect(result.frame.compressedSize).toBe(50000);
        expect(result.frame.compressionId).toBe(0x01);
        expect(result.frame.symbolId).toBe(42);
        expect(result.frame.filename).toBe("sample.bin");
        expect(result.frame.fileSize).toBe(60000);
        expect(result.frame.sha256).toEqual(new Uint8Array(32).fill(0xCC));
        expect(result.frame.payload).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      }
    });

    it("serializes to expected binary size", () => {
      const serialized = serializeFrame(sampleFrame);
      const filenameLen = new TextEncoder().encode(sampleFrame.filename).length;
      const expectedSize = getFrameOverhead(filenameLen) + sampleFrame.payload.length;
      expect(serialized.length).toBe(expectedSize);
    });

    it("uses little-endian for multi-byte fields", () => {
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: new Uint8Array([0, 0, 0, 0]),
        sourceBlockCount: 0x0102, // 258
        blockSize: 0x0304, // 772
        compressedSize: 0x05060708,
        compressionId: 0x00,
        symbolId: 0x090A0B0C,
        filename: "",
        fileSize: 0,
        sha256: new Uint8Array(32),
        payload: new Uint8Array([]),
      };
      const serialized = serializeFrame(frame);
      // K at offset 6: LE -> 0x02, 0x01
      expect(serialized[6]).toBe(0x02);
      expect(serialized[7]).toBe(0x01);
      // blockSize at offset 8: LE -> 0x04, 0x03
      expect(serialized[8]).toBe(0x04);
      expect(serialized[9]).toBe(0x03);
      // compressedSize at offset 10: LE -> 0x08, 0x07, 0x06, 0x05
      expect(serialized[10]).toBe(0x08);
      expect(serialized[11]).toBe(0x07);
      expect(serialized[12]).toBe(0x06);
      expect(serialized[13]).toBe(0x05);
      // compressionId at offset 14
      expect(serialized[14]).toBe(0x00);
      // symbolId at offset 15: LE -> 0x0C, 0x0B, 0x0A, 0x09
      expect(serialized[15]).toBe(0x0C);
      expect(serialized[16]).toBe(0x0B);
      expect(serialized[17]).toBe(0x0A);
      expect(serialized[18]).toBe(0x09);
    });
  });

  describe("metadata embedded in frame", () => {
    it("roundtrips a frame with metadata fields", () => {
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        flags: 0x00,
        metadataHash: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
        sourceBlockCount: 50,
        blockSize: 512,
        compressedSize: 10000,
        compressionId: 0x01,
        symbolId: 1,
        filename: "test.txt",
        fileSize: 12345,
        sha256: new Uint8Array(32).fill(0xAB),
        payload: new Uint8Array([10, 20, 30]),
      };
      const serialized = serializeFrame(frame);
      const result = parseFrame(serialized);
      expect(result.kind).toBe("data");
      if (result.kind === "data") {
        expect(result.frame.filename).toBe("test.txt");
        expect(result.frame.fileSize).toBe(12345);
        expect(result.frame.compressedSize).toBe(10000);
        expect(result.frame.compressionId).toBe(0x01);
        expect(result.frame.sha256).toEqual(new Uint8Array(32).fill(0xAB));
        expect(result.frame.symbolId).toBe(1);
        expect(result.frame.payload).toEqual(new Uint8Array([10, 20, 30]));
      }
    });

    it("handles unicode filenames", () => {
      const frame: Frame = {
        ...sampleFrame,
        filename: "日本語ファイル.pdf",
      };
      const serialized = serializeFrame(frame);
      const result = parseFrame(serialized);
      expect(result.kind).toBe("data");
      if (result.kind === "data") {
        expect(result.frame.filename).toBe("日本語ファイル.pdf");
      }
    });
  });

  describe("error handling", () => {
    it("rejects unknown protocol version", () => {
      const serialized = serializeFrame(sampleFrame);
      serialized[0] = 0xFF; // corrupt version
      const result = parseFrame(serialized);
      expect(result.kind).toBe("unknown_version");
      if (result.kind === "unknown_version") {
        expect(result.version).toBe(0xFF);
      }
    });

    it("rejects truncated frames", () => {
      const serialized = serializeFrame(sampleFrame);
      const truncated = serialized.slice(0, 5); // too short
      const result = parseFrame(truncated);
      expect(result.kind).toBe("error");
    });
  });

  it("PROTOCOL_VERSION is 0x03", () => {
    expect(PROTOCOL_VERSION).toBe(0x03);
  });

  it("BASE_HEADER_SIZE is 19 bytes", () => {
    expect(BASE_HEADER_SIZE).toBe(19);
  });
});
