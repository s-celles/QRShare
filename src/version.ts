export const APP_VERSION = "0.1.3";

declare const __BUILD_HASH__: string;
export const BUILD_HASH = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";
