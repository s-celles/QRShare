import { describe, expect, it } from "bun:test";
import {
  HANDOFF_TYPE,
  MAX_HANDOFF_BYTES,
  parseHandoffMessage,
  parseReturnUrl,
  receiveFromOpener,
  sendFileToWindow,
  type WindowLike,
} from "@/share/handoff";

/** Minimal window double: postMessage delivers a message event to this window, from its peer. */
class FakeWindow implements WindowLike {
  opener: FakeWindow | null = null;
  sent: { data: unknown; targetOrigin: string }[] = [];
  peer: FakeWindow | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();
  constructor(public origin: string) {}
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }
  postMessage(data: unknown, targetOrigin: string): void {
    this.sent.push({ data, targetOrigin });
    const from = this.peer;
    queueMicrotask(() => {
      if (targetOrigin !== "*" && targetOrigin !== this.origin) return;
      const event = { data, origin: from?.origin ?? "null", source: from } as unknown as MessageEvent;
      for (const listener of [...this.listeners]) listener(event);
    });
  }
}

const msg = (action: string, extra: object = {}) => ({ type: HANDOFF_TYPE, version: 1, action, ...extra });

describe("REQ-HANDOFF-003 message validation", () => {
  it("accepts well-formed messages only", () => {
    const data = new TextEncoder().encode("hi").buffer;
    expect(parseHandoffMessage(msg("ready"))).toEqual({ action: "ready" });
    expect(parseHandoffMessage(msg("file", { name: "a.md", mimeType: "text/markdown", data }))).toEqual({ action: "file", name: "a.md", mimeType: "text/markdown", data });
    expect(parseHandoffMessage(msg("received"))).toEqual({ action: "received" });
    expect(parseHandoffMessage({ ...msg("ready"), version: 2 })).toBeNull();
    expect(parseHandoffMessage({ type: "other", version: 1, action: "ready" })).toBeNull();
    expect(parseHandoffMessage(msg("file", { name: "a", mimeType: "x", data: "not a buffer" }))).toBeNull();
    expect(parseHandoffMessage(msg("file", { name: "", mimeType: "x", data }))).toBeNull();
    expect(parseHandoffMessage("ready")).toBeNull();
  });

  it("rejects oversized files and unsafe names", () => {
    const big = { byteLength: MAX_HANDOFF_BYTES + 1 } as ArrayBuffer;
    expect(parseHandoffMessage(msg("file", { name: "a", mimeType: "x", data: big }))).toBeNull();
    const parsed = parseHandoffMessage(msg("file", { name: "../../etc/passwd", mimeType: "", data: new ArrayBuffer(1) }));
    expect(parsed).toMatchObject({ name: "passwd", mimeType: "application/octet-stream" });
  });
});

describe("REQ-HANDOFF-004 return URL", () => {
  it("accepts http(s) URLs without credentials only", () => {
    expect(parseReturnUrl("https://s-celles.github.io/progressive-web-office/?handoff=1")?.host).toBe("s-celles.github.io");
    expect(parseReturnUrl("http://localhost:4173/")?.origin).toBe("http://localhost:4173");
    expect(parseReturnUrl("javascript:alert(1)")).toBeNull();
    expect(parseReturnUrl("https://user:pw@example.org/")).toBeNull();
    expect(parseReturnUrl("not a url")).toBeNull();
    expect(parseReturnUrl(null)).toBeNull();
  });
});

describe("REQ-HANDOFF-002/004 handoff between two windows", () => {
  it("delivers a file from the opener to the opened window", async () => {
    const app = new FakeWindow("https://app.example");
    const qrshare = new FakeWindow("https://qrshare.example");
    qrshare.opener = app;
    // Each window's messages come from its peer.
    app.peer = qrshare;
    qrshare.peer = app;

    const file = new File(["# Hello"], "notes.md", { type: "text/markdown" });
    const sending = sendFileToWindow(app, qrshare, "https://qrshare.example", file, 1000);
    const received = await receiveFromOpener(qrshare, 1000);
    expect(await sending).toBe("sent");
    expect(received?.origin).toBe("https://app.example");
    expect(received?.file.name).toBe("notes.md");
    expect(received?.file.type).toBe("text/markdown");
    expect(await received?.file.text()).toBe("# Hello");
    // The file was posted with the exact target origin, never "*".
    const filePost = qrshare.sent.find((s) => (s.data as { action?: string }).action === "file");
    expect(filePost?.targetOrigin).toBe("https://qrshare.example");
  });

  it("does not send the file to a window of another origin", async () => {
    const app = new FakeWindow("https://app.example");
    const evil = new FakeWindow("https://evil.example");
    evil.opener = app;
    app.peer = evil;
    evil.peer = app;
    const file = new File(["secret"], "s.txt");
    const sending = sendFileToWindow(app, evil, "https://qrshare.example", file, 200);
    await receiveFromOpener(evil, 200);
    expect(await sending).toBe("timeout");
    expect(evil.sent.some((s) => (s.data as { action?: string }).action === "file")).toBe(false);
  });

  it("ignores files that do not come from the opener", async () => {
    const qrshare = new FakeWindow("https://qrshare.example");
    const app = new FakeWindow("https://app.example");
    qrshare.opener = app;
    const stranger = new FakeWindow("https://stranger.example");
    qrshare.peer = stranger; // messages appear to come from another window
    const receiving = receiveFromOpener(qrshare, 200);
    qrshare.postMessage(msg("file", { name: "x.txt", mimeType: "text/plain", data: new ArrayBuffer(1) }), "*");
    expect(await receiving).toBeNull();
  });

  it("resolves null without an opener", async () => {
    const lonely = new FakeWindow("https://qrshare.example");
    expect(await receiveFromOpener(lonely, 50)).toBeNull();
  });
});
