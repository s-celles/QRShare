import { describe, expect, it } from "bun:test";
import {
  encodeFlags,
  decodeFlags,
  FLAG_TEXT,
  serializeFrame,
  parseFrame,
  PROTOCOL_VERSION,
  type Frame,
} from "@/protocol/frame";
import {
  textToBuffer,
  TEXT_FILENAME,
  TEXT_MIME_TYPE,
  isTextMimeType,
} from "@/ui/shared-file";

describe("Protocol FLAG_TEXT", () => {
  it("encodeFlags sets FLAG_TEXT bit when isText is true", () => {
    const flags = encodeFlags({ isText: true });
    expect(flags & FLAG_TEXT).toBe(FLAG_TEXT);
  });

  it("encodeFlags clears FLAG_TEXT bit when isText is false", () => {
    const flags = encodeFlags({ isText: false });
    expect(flags & FLAG_TEXT).toBe(0);
  });

  it("decodeFlags round-trips isText=true", () => {
    const encoded = encodeFlags({ isText: true });
    const decoded = decodeFlags(encoded);
    expect(decoded.isText).toBe(true);
  });

  it("decodeFlags round-trips isText=false", () => {
    const encoded = encodeFlags({ isText: false });
    const decoded = decodeFlags(encoded);
    expect(decoded.isText).toBe(false);
  });

  it("decodeFlags preserves unknown flag bits", () => {
    // Set some unknown bits along with FLAG_TEXT
    const flags = FLAG_TEXT | 0x80;
    const decoded = decodeFlags(flags);
    expect(decoded.isText).toBe(true);
  });

  it("FLAG_TEXT survives frame serialize/parse roundtrip", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: encodeFlags({ isText: true }),
      metadataHash: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
      sourceBlockCount: 10,
      blockSize: 256,
      compressedSize: 1000,
      compressionId: 0x01,
      symbolId: 1,
      filename: TEXT_FILENAME,
      fileSize: 500,
      sha256: new Uint8Array(32).fill(0xAA),
      payload: new Uint8Array([1, 2, 3]),
    };

    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(decodeFlags(result.frame.flags).isText).toBe(true);
      expect(result.frame.filename).toBe(TEXT_FILENAME);
    }
  });

  it("frame without FLAG_TEXT has isText=false", () => {
    const frame: Frame = {
      version: PROTOCOL_VERSION,
      flags: 0x00,
      metadataHash: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
      sourceBlockCount: 10,
      blockSize: 256,
      compressedSize: 1000,
      compressionId: 0x01,
      symbolId: 1,
      filename: "file.bin",
      fileSize: 500,
      sha256: new Uint8Array(32).fill(0xBB),
      payload: new Uint8Array([1, 2, 3]),
    };

    const serialized = serializeFrame(frame);
    const result = parseFrame(serialized);
    expect(result.kind).toBe("data");
    if (result.kind === "data") {
      expect(decodeFlags(result.frame.flags).isText).toBe(false);
    }
  });
});

describe("textToBuffer", () => {
  it("converts ASCII text to UTF-8 ArrayBuffer", () => {
    const buffer = textToBuffer("hello");
    const bytes = new Uint8Array(buffer);
    expect(bytes).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
  });

  it("preserves emoji in UTF-8 encoding", () => {
    const text = "Hello 🌍!";
    const buffer = textToBuffer(text);
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(text);
  });

  it("preserves CJK characters", () => {
    const text = "你好世界";
    const buffer = textToBuffer(text);
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(text);
  });

  it("preserves RTL Arabic text", () => {
    const text = "مرحبا بالعالم";
    const buffer = textToBuffer(text);
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(text);
  });

  it("preserves newlines and whitespace", () => {
    const text = "line 1\nline 2\n\ttabbed";
    const buffer = textToBuffer(text);
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(text);
  });

  it("returns empty buffer for empty string", () => {
    const buffer = textToBuffer("");
    expect(new Uint8Array(buffer).length).toBe(0);
  });
});

describe("isTextMimeType", () => {
  it("returns true for text/plain", () => {
    expect(isTextMimeType("text/plain")).toBe(true);
  });

  it("returns true for text/plain with charset", () => {
    expect(isTextMimeType(TEXT_MIME_TYPE)).toBe(true);
  });

  it("returns true for text/html", () => {
    expect(isTextMimeType("text/html")).toBe(true);
  });

  it("returns false for application/octet-stream", () => {
    expect(isTextMimeType("application/octet-stream")).toBe(false);
  });

  it("returns false for image/png", () => {
    expect(isTextMimeType("image/png")).toBe(false);
  });
});

describe("Constants", () => {
  it("TEXT_FILENAME is message.txt", () => {
    expect(TEXT_FILENAME).toBe("message.txt");
  });

  it("TEXT_MIME_TYPE starts with text/", () => {
    expect(TEXT_MIME_TYPE.startsWith("text/")).toBe(true);
  });
});
