import type { Room } from "trystero";
import { joinRoom as joinNostr, defaultRelayUrls as nostrRelayUrls } from "trystero/nostr";
import { joinRoom as joinTorrent, defaultRelayUrls as torrentRelayUrls } from "trystero/torrent";

export type StrategyName = "nostr" | "torrent" | "mqtt";

export interface JoinRoomConfig {
  appId: string;
  password: string;
  relayRedundancy: number;
  relayUrls?: string[];
}

export interface StrategyAdapter {
  name: StrategyName;
  joinRoom: (config: JoinRoomConfig, roomId: string) => Room;
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

const nostrAdapter: StrategyAdapter = {
  name: "nostr",
  joinRoom: joinNostr,
};

const torrentAdapter: StrategyAdapter = {
  name: "torrent",
  joinRoom: joinTorrent,
};

const STATIC_STRATEGIES: Record<string, StrategyAdapter> = {
  nostr: nostrAdapter,
  torrent: torrentAdapter,
};

async function loadMqttAdapter(): Promise<StrategyAdapter> {
  const { joinRoom } = await import("trystero/mqtt");
  return { name: "mqtt", joinRoom };
}

export const DEFAULT_STRATEGIES: StrategyName[] = ["nostr", "torrent"];
export const ALL_STRATEGIES: StrategyName[] = ["nostr", "torrent", "mqtt"];

export async function getAdapter(name: StrategyName): Promise<StrategyAdapter> {
  if (name in STATIC_STRATEGIES) return STATIC_STRATEGIES[name];
  if (name === "mqtt") return loadMqttAdapter();
  throw new Error(`Unknown strategy: ${name}`);
}
