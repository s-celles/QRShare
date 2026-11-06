import { signal } from "@preact/signals";

export type Route =
  | "/"
  | "/scan"
  | "/scan/auto"
  | "/create"
  | "/create/url"
  | "/send"
  | "/send/qr"
  | "/receive/qr"
  | "/send/cimbar"
  | "/receive/cimbar"
  | "/send/audio"
  | "/receive/audio"
  | "/audio/session"
  | "/send/webrtc"
  | "/receive/webrtc"
  | "/collab"
  | "/paste"
  | "/paste/verify"
  | "/send/share"
  | "/guide"
  | "/docs"
  | "/settings"
  | "/settings/webrtc"
  | "/about";

const VALID_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/scan",
  "/scan/auto",
  "/create",
  "/create/url",
  "/send",
  "/send/qr",
  "/receive/qr",
  "/send/cimbar",
  "/receive/cimbar",
  "/send/audio",
  "/receive/audio",
  "/audio/session",
  "/send/webrtc",
  "/receive/webrtc",
  "/collab",
  "/paste",
  "/paste/verify",
  "/send/share",
  "/guide",
  "/docs",
  "/settings",
  "/settings/webrtc",
  "/about",
]);

/** True when `path` (the part of the hash before "?") is a known route. */
export function isValidRoute(path: string): path is Route {
  return VALID_ROUTES.has(path);
}

export const hashParams = signal<URLSearchParams>(new URLSearchParams());

function getRouteFromHash(): Route {
  const raw = window.location.hash.slice(1) || "/";
  const [path, query] = raw.split("?", 2);
  hashParams.value = new URLSearchParams(query || "");
  return isValidRoute(path) ? path : "/";
}

export const currentRoute = signal<Route>(
  typeof window !== "undefined" ? getRouteFromHash() : "/",
);

export function navigate(route: Route | (string & {})): void {
  window.location.hash = route;
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    currentRoute.value = getRouteFromHash();
  });
}
