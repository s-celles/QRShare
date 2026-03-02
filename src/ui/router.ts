import { signal } from "@preact/signals";

export type Route =
  | "/"
  | "/send/qr"
  | "/receive/qr"
  | "/send/webrtc"
  | "/receive/webrtc"
  | "/settings";

const VALID_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/send/qr",
  "/receive/qr",
  "/send/webrtc",
  "/receive/webrtc",
  "/settings",
]);

function getRouteFromHash(): Route {
  const hash = window.location.hash.slice(1) || "/";
  return VALID_ROUTES.has(hash) ? (hash as Route) : "/";
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
