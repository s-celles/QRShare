export const APP_VERSION = "0.3.0";

declare const __BUILD_HASH__: string;
export const BUILD_HASH = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

declare const __BUILD_DATE__: string;
/** ISO date of the production build; empty in development. */
export const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";
