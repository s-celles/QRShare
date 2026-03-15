import { signal } from "@preact/signals";

export type Route =
  | "/"
  | "/scan"
  | "/create"
  | "/send/qr"
  | "/receive/qr"
  | "/send/webrtc"
  | "/receive/webrtc"
  | "/send/share"
  | "/guide"
  | "/settings"
  | "/settings/webrtc"
  | "/about";

const VALID_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/scan",
  "/create",
  "/send/qr",
  "/receive/qr",
  "/send/webrtc",
  "/receive/webrtc",
  "/send/share",
  "/guide",
  "/settings",
  "/settings/webrtc",
  "/about",
]);

export const hashParams = signal<URLSearchParams>(new URLSearchParams());

function getRouteFromHash(): Route {
  const raw = window.location.hash.slice(1) || "/";
  const [path, query] = raw.split("?", 2);
  hashParams.value = new URLSearchParams(query || "");
  return VALID_ROUTES.has(path) ? (path as Route) : "/";
}

export const currentRoute = signal<Route>(
  typeof window !== "undefined" ? getRouteFromHash() : "/",
);

export function navigate(route: Route): void {
  window.location.hash = route;
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    currentRoute.value = getRouteFromHash();
  });
}
