import { signal, effect } from "@preact/signals";
import { ALL_STRATEGIES, DEFAULT_RELAY_URLS, type StrategyName } from "./strategies";
import type { ConnectionMode, RoomConfig } from "./types";

export interface StrategySettings {
  enabledStrategies: StrategyName[];
  relayUrls: Record<StrategyName, string[]>;
  connectionMode: ConnectionMode;
}

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  enabledStrategies: ["nostr", "torrent", "mqtt"],
  relayUrls: {
    nostr: [],
    torrent: DEFAULT_RELAY_URLS.torrent ?? [],
    mqtt: [],
  },
  connectionMode: "parallel",
};

function loadSettings(): StrategySettings {
  if (typeof localStorage === "undefined") return DEFAULT_STRATEGY_SETTINGS;
  try {
    const raw = localStorage.getItem("qrshare-webrtc-settings");
    if (!raw) return DEFAULT_STRATEGY_SETTINGS;
    const parsed = JSON.parse(raw);
    const valid = (parsed.enabledStrategies ?? []).filter(
      (s: string) => ALL_STRATEGIES.includes(s as StrategyName),
    ) as StrategyName[];
    return {
      enabledStrategies:
        valid.length > 0 ? valid : DEFAULT_STRATEGY_SETTINGS.enabledStrategies,
      relayUrls: {
        nostr: parsed.relayUrls?.nostr ?? [],
        torrent: parsed.relayUrls?.torrent ?? DEFAULT_STRATEGY_SETTINGS.relayUrls.torrent,
        mqtt: parsed.relayUrls?.mqtt ?? [],
      },
      connectionMode:
        parsed.connectionMode === "sequential" ? "sequential" : "parallel",
    };
  } catch {
    return DEFAULT_STRATEGY_SETTINGS;
  }
}

export const strategySettings = signal<StrategySettings>(loadSettings());

if (typeof window !== "undefined") {
  effect(() => {
    localStorage.setItem(
      "qrshare-webrtc-settings",
      JSON.stringify(strategySettings.value),
    );
  });
}

export function buildRoomConfig(): RoomConfig {
  const s = strategySettings.value;
  return {
    appId: "qrshare-webrtc-v1",
    relayRedundancy: 3,
    strategies: s.enabledStrategies,
    relayUrls: s.relayUrls,
    connectionMode: s.connectionMode,
  };
}

export function resetStrategySettings(): void {
  strategySettings.value = { ...DEFAULT_STRATEGY_SETTINGS };
}
