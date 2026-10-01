/**
 * The version log now lives in the shared collaboration core
 * (`@/collab/core`), so QRShare and other apps speak the same protocol.
 */
export { VersionLog, encodeVersionEntry, decodeVersionEntry, type VersionEntry } from "./core/versions";
