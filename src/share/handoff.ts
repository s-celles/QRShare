/**
 * App handoff protocol, version 1 (REQ-HANDOFF-002..005).
 *
 * Lets another web application hand a file to QRShare, or receive a file from
 * QRShare, through `window.postMessage` between two windows of the same
 * browser. See `.claude/specs/app-handoff.md`.
 */

export const HANDOFF_TYPE = "qrshare-handoff";
export const HANDOFF_VERSION = 1;
export const MAX_HANDOFF_BYTES = 200 * 1024 * 1024;

export type HandoffMessage =
  | { action: "ready" }
  | { action: "received" }
  | { action: "file"; name: string; mimeType: string; data: ArrayBuffer };

/** The parts of `Window` used by the protocol (injectable for tests). */
export interface WindowLike {
  readonly opener: WindowLike | null;
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

const envelope = (action: string, extra: object = {}) => ({ type: HANDOFF_TYPE, version: HANDOFF_VERSION, action, ...extra });

/** Keep only the last path segment of a file name. */
function safeName(name: string): string {
  return name.split(/[\\/]/).pop()?.trim() ?? "";
}

/** Validate an incoming message; returns null for anything unexpected. */
export function parseHandoffMessage(data: unknown): HandoffMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type !== HANDOFF_TYPE || m.version !== HANDOFF_VERSION) return null;
  if (m.action === "ready" || m.action === "received") return { action: m.action };
  if (m.action !== "file") return null;
  if (typeof m.name !== "string" || typeof m.mimeType !== "string") return null;
  const isBuffer = m.data instanceof ArrayBuffer || (typeof m.data === "object" && m.data !== null && typeof (m.data as ArrayBuffer).byteLength === "number" && !(ArrayBuffer.isView(m.data)));
  if (!isBuffer) return null;
  const data_ = m.data as ArrayBuffer;
  if (data_.byteLength > MAX_HANDOFF_BYTES) return null;
  const name = safeName(m.name);
  if (!name || name === "." || name === "..") return null;
  return { action: "file", name, mimeType: m.mimeType || "application/octet-stream", data: data_ };
}

/** Validate the `return` URL of a calling application (http(s), no credentials). */
export function parseReturnUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Receiving side: announce readiness to `self.opener` and resolve with the
 * first valid file it sends (null on timeout or without an opener).
 */
export function receiveFromOpener(self: WindowLike, timeoutMs = 30_000): Promise<{ file: File; origin: string } | null> {
  const opener = self.opener;
  if (!opener) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (value: { file: File; origin: string } | null): void => {
      clearTimeout(timer);
      self.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== (opener as unknown)) return;
      const message = parseHandoffMessage(event.data);
      if (message?.action !== "file") return;
      opener.postMessage(envelope("received"), event.origin);
      done({ file: new File([message.data], message.name, { type: message.mimeType }), origin: event.origin });
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    self.addEventListener("message", onMessage);
    // The ready signal carries no data, so any target origin is acceptable.
    opener.postMessage(envelope("ready"), "*");
  });
}

/**
 * Sending side: wait until `target` (a window this one opened) is ready and
 * belongs to `expectedOrigin`, then post `file` to that origin only.
 */
export function sendFileToWindow(self: WindowLike, target: WindowLike, expectedOrigin: string, file: File, timeoutMs = 30_000): Promise<"sent" | "timeout"> {
  return new Promise((resolve) => {
    let posted = false;
    const done = (value: "sent" | "timeout"): void => {
      clearTimeout(timer);
      self.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== (target as unknown) || event.origin !== expectedOrigin) return;
      const message = parseHandoffMessage(event.data);
      if (message?.action === "ready" && !posted) {
        posted = true;
        void file.arrayBuffer().then((data) => {
          target.postMessage(envelope("file", { name: file.name, mimeType: file.type, data }), expectedOrigin, [data]);
        });
      } else if (message?.action === "received" && posted) {
        done("sent");
      }
    };
    const timer = setTimeout(() => done("timeout"), timeoutMs);
    self.addEventListener("message", onMessage);
  });
}

/** Open `url` in a new window and hand it `file` (REQ-HANDOFF-004). */
export async function openAndSend(url: URL, file: File, timeoutMs = 60_000): Promise<"sent" | "timeout" | "blocked"> {
  // No "noopener": the application must be able to answer through `opener`.
  const target = window.open(url.href, "_blank");
  if (!target) return "blocked";
  return sendFileToWindow(window as unknown as WindowLike, target as unknown as WindowLike, url.origin, file, timeoutMs);
}

const RETURN_KEY = "qrshare-handoff-return";

/** Remember the calling application's return URL for this browser session. */
export function rememberReturnUrl(value: string | null): void {
  const url = parseReturnUrl(value);
  if (!url || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(RETURN_KEY, url.href);
}

export function getReturnUrl(): URL | null {
  return typeof sessionStorage === "undefined" ? null : parseReturnUrl(sessionStorage.getItem(RETURN_KEY));
}
