export { ACTIONS, sharedRoom, toArrayBuffer, type CollabPayload, type CollabRoom } from "./room.js";
export { Emitter } from "./emitter.js";
export { DocSync, REMOTE_ORIGIN, type DocSyncEvents } from "./sync.js";
export { VersionLog, VersionSync, encodeVersionEntry, decodeVersionEntry, type VersionEntry, type VersionSyncEvents } from "./versions.js";
export { Presence, type Participant, type PresenceState, type PresenceEvents } from "./presence.js";
export { colorOf, createIdentity, loadIdentity, saveIdentity, type Identity } from "./identity.js";
export { attachDocPersistence, isPersistenceAvailable, loadVersionEntries, saveVersionEntry, type DocPersistence, type PersistenceOptions } from "./persistence.js";
export { docFromSnapshot, restoreShared, setText, type Schema } from "./restore.js";
export { CollabSession, type CollabSessionEvents, type CollabSessionOptions } from "./session.js";
