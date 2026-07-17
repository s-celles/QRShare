import type { Room } from "trystero";
import { joinRoom as joinNostr, defaultRelayUrls as nostrRelayUrls } from "trystero/nostr";
import { joinRoom as joinTorrent, defaultRelayUrls as torrentRelayUrls } from "trystero/torrent";

export type StrategyName = "nostr" | "torrent" | "mqtt";

export interface JoinRoomConfig {
  appId: string;
  password: string;
  relayRedundancy: number;
  relayUrls?: string[];
  rtcConfig?: {
    iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  };
  turnConfig?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

/**
 * Trystero fires this only when an offer/answer fails to decrypt, i.e. the two
 * peers derived different keys from different passwords (`strategy.js:104-110`).
 */
export interface JoinErrorDetails {
  error: string;
  appId: string;
  roomId: string;
  peerId: string;
}

export interface StrategyAdapter {
  name: StrategyName;
  joinRoom: (
    config: JoinRoomConfig,
    roomId: string,
    onJoinError?: (details: JoinErrorDetails) => void,
  ) => Room;
}

/** Default relay URLs imported from Trystero at build time. */
export const DEFAULT_RELAY_URLS: Record<StrategyName, string[]> = {
  nostr: nostrRelayUrls,
  torrent: torrentRelayUrls,
  mqtt: [], // loaded lazily, see getDefaultMqttRelayUrls()
};

/** Load mqtt default relay URLs on demand (avoids bundling mqtt statically). */
export async function getDefaultMqttRelayUrls(): Promise<string[]> {
  const { defaultRelayUrls } = await import("trystero/mqtt");
  return defaultRelayUrls;
}

/**
 * Trystero's per-strategy type declarations are stale about the third argument:
 * `nostr.d.ts` / `torrent.d.ts` declare it as `manualRelayReconnection?: boolean`
 * and `mqtt.d.ts` omits it entirely. At runtime every strategy is produced by the
 * same factory, whose signature is `(config, roomId, onJoinError)`
 * (`node_modules/trystero/src/strategy.js:30`, invoked at `:105`) — and
 * `manualRelayReconnection` is read from `config` (`strategy.js:242`), never from
 * an argument. Only the generic `index.d.ts:110-119` gets this right. These casts
 * therefore follow the runtime, not the declaration.
 */
const asAdapterJoin = (fn: unknown) => fn as StrategyAdapter["joinRoom"];

const nostrAdapter: StrategyAdapter = {
  name: "nostr",
  joinRoom: asAdapterJoin(joinNostr),
};

const torrentAdapter: StrategyAdapter = {
  name: "torrent",
  joinRoom: asAdapterJoin(joinTorrent),
};

const STATIC_STRATEGIES: Record<string, StrategyAdapter> = {
  nostr: nostrAdapter,
  torrent: torrentAdapter,
};

async function loadMqttAdapter(): Promise<StrategyAdapter> {
  const { joinRoom } = await import("trystero/mqtt");
  return { name: "mqtt", joinRoom: asAdapterJoin(joinRoom) };
}

export const DEFAULT_STRATEGIES: StrategyName[] = ["nostr", "torrent"];
export const ALL_STRATEGIES: StrategyName[] = ["nostr", "torrent", "mqtt"];

export async function getAdapter(name: StrategyName): Promise<StrategyAdapter> {
  if (name in STATIC_STRATEGIES) return STATIC_STRATEGIES[name];
  if (name === "mqtt") return loadMqttAdapter();
  throw new Error(`Unknown strategy: ${name}`);
}
