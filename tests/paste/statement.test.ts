import { describe, expect, it } from "bun:test";
import {
  MAX_SOURCE_BYTES,
  StatementError,
  decodeStatement,
  encodeStatement,
  normalizeSource,
  openItem,
  pasteIdOf,
  sealItem,
  signStatement,
  verifyStatement,
} from "@/paste/statement";
import { attachmentRef, createAuthor, fields, hex, roomKeys, sha256 } from "./helpers";

const enc = new TextEncoder();

describe("REQ-PASTE-012 / REQ-PASTE-020 statement encoding and signing", () => {
  it("round-trips both formats, with attachments", async () => {
    const author = await createAuthor();
    const img = await attachmentRef(new Uint8Array([1, 2, 3]), { mime: "image/webp", name: "photo.webp", width: 640, height: 480 });
    const pdf = await attachmentRef(new Uint8Array([4, 5]));
    for (const format of ["text", "markdown"] as const) {
      const f = await fields(author, { format, attachments: [img, pdf], source: "héllo ``` 😀\nline" });
      const statement = encodeStatement(f);
      const decoded = decodeStatement(statement);
      expect(decoded.format).toBe(format);
      expect(decoded.source).toBe(f.source);
      expect(decoded.declaredAt).toBe(f.declaredAt);
      expect(hex(decoded.tag)).toBe(hex(f.tag));
      expect(hex(decoded.author)).toBe(hex(author.key.publicKey));
      expect(decoded.attachments.map((a) => ({ ...a, hash: hex(a.hash) }))).toEqual([img, pdf].map((a) => ({ ...a, hash: hex(a.hash) })));
      const signature = await signStatement(statement, author.key.privateKey);
      expect(signature.length).toBe(64);
      expect(await verifyStatement(statement, signature, author.key.publicKey)).toBe(true);
    }
  });

  it("starts with the QPST magic and version 1", async () => {
    const statement = encodeStatement(await fields(await createAuthor()));
    expect(new TextDecoder().decode(statement.subarray(0, 4))).toBe("QPST");
    expect(statement[4]).toBe(1);
  });
});

describe("REQ-PASTE-054 paste id", () => {
  it("is the SHA-256 of the statement and excludes the signature", async () => {
    const author = await createAuthor();
    const keys = await roomKeys();
    const statement = encodeStatement(await fields(author));
    const item = await sealItem(statement, author.key.privateKey);
    const opened = await openItem(item, keys.tag);
    expect(hex(opened.id)).toBe(hex(await sha256(statement)));
    expect(hex(await pasteIdOf(statement))).toBe(hex(opened.id));
  });
});

describe("REQ-PASTE-013 rejection of tampered or malformed items", () => {
  it("rejects any tampered field or signature", async () => {
    const author = await createAuthor();
    const other = await createAuthor();
    const keys = await roomKeys();
    const att = await attachmentRef(new Uint8Array([9]));
    const statement = encodeStatement(await fields(author, { attachments: [att] }));
    const item = await sealItem(statement, author.key.privateKey);
    await openItem(item, keys.tag); // valid

    const flip = async (offset: number) => {
      const bad = item.slice();
      bad[offset] ^= 1;
      return openItem(bad, keys.tag);
    };
    const n = statement.length;
    // tag, key, timestamp, format, source, attachment hash, size, name, signature
    for (const offset of [5, 21, 60, 61, 66, 70, n - 60, n - 30, n - 20, n - 6, n + 3]) {
      await expect(flip(offset)).rejects.toBeInstanceOf(StatementError);
    }
    // another room
    await expect(openItem(item, new Uint8Array(16))).rejects.toThrow(/room/);
    // signed by someone else than the key it names
    const forged = await sealItem(statement, other.key.privateKey);
    await expect(openItem(forged, keys.tag)).rejects.toThrow(/signature/);
  });

  it("rejects oversize, truncated and malformed statements", async () => {
    const author = await createAuthor();
    const base = await fields(author);
    expect(() => encodeStatement({ ...base, source: "x".repeat(MAX_SOURCE_BYTES + 1) })).toThrow(StatementError);
    expect(() => encodeStatement({ ...base, source: "é".repeat(MAX_SOURCE_BYTES / 2 + 1) })).toThrow(StatementError);
    expect(encodeStatement({ ...base, source: "x".repeat(MAX_SOURCE_BYTES) }).length).toBeGreaterThan(MAX_SOURCE_BYTES);
    const five = await Promise.all([1, 2, 3, 4, 5].map((i) => attachmentRef(new Uint8Array([i]))));
    expect(() => encodeStatement({ ...base, attachments: five })).toThrow(/attachments/);
    expect(() => encodeStatement({ ...base, attachments: [{ ...five[0], name: "../x.pdf" }] })).toThrow(/name/);
    expect(() => encodeStatement({ ...base, attachments: [{ ...five[0], mime: "text/html; charset=utf-8" }] })).toThrow(/MIME/);
    expect(() => encodeStatement({ ...base, attachments: [{ ...five[0], size: 5 * 1024 * 1024 + 1 }] })).toThrow(/large/);
    expect(() => encodeStatement({ ...base, attachments: [{ ...five[0], width: 10, height: 10, size: 1.5 * 1024 * 1024 + 1 }] })).toThrow(/large/);
    expect(() => encodeStatement({ ...base, source: "a\r\nb" })).toThrow(StatementError);
    expect(() => encodeStatement({ ...base, source: "﻿a" })).toThrow(StatementError);
    expect(() => encodeStatement({ ...base, declaredAt: 2 ** 53 })).toThrow(StatementError);

    const good = encodeStatement({ ...base, attachments: [five[0]] });
    expect(() => decodeStatement(good.subarray(0, good.length - 1))).toThrow(StatementError);
    expect(() => decodeStatement(new Uint8Array([...good, 0]))).toThrow(StatementError);
    const badVersion = good.slice();
    badVersion[4] = 2;
    expect(() => decodeStatement(badVersion)).toThrow(/version/);
    const badFormat = good.slice();
    badFormat[61] = 3;
    expect(() => decodeStatement(badFormat)).toThrow(/format/);

    // invalid UTF-8 in the source
    const utf = encodeStatement({ ...base, source: "ab" });
    utf[66] = 0xff;
    expect(() => decodeStatement(utf)).toThrow(StatementError);

    // a name that would change when sanitised is malformed
    const unsafe = encodeStatement({ ...base, attachments: [{ ...five[0], name: "abcd.pdf" }] });
    const at = unsafe.length - 4 - 8;
    unsafe.set(enc.encode("a/cd"), at);
    expect(() => decodeStatement(unsafe)).toThrow(/name/);
  });
});

describe("REQ-PASTE-021 source canonical form", () => {
  it("normalises line endings to LF and drops a BOM, without Unicode normalisation", () => {
    expect(normalizeSource("﻿a\r\nb\rc\n")).toBe("a\nb\nc\n");
    const nfd = "é";
    expect(normalizeSource(nfd)).toBe(nfd);
  });
});
