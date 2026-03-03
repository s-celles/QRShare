import type { Room } from "trystero";
import { joinRoom as joinNostr } from "trystero/nostr";
import { joinRoom as joinTorrent } from "trystero/torrent";

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
  defaultRelayUrls?: string[];
}

const nostrAdapter: StrategyAdapter = {
  name: "nostr",
  joinRoom: joinNostr,
};

const torrentAdapter: StrategyAdapter = {
  name: "torrent",
  joinRoom: joinTorrent,
  defaultRelayUrls: [
    "wss://tracker.webtorrent.dev",
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.files.fm:7073/announce",
  ],
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
