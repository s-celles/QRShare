import { signal, effect } from "@preact/signals";
import { ALL_STRATEGIES, DEFAULT_RELAY_URLS, getDefaultMqttRelayUrls, type StrategyName } from "./strategies";
import type { ConnectionMode, IceServerConfig, RoomConfig } from "./types";

export interface StrategySettings {
  enabledStrategies: StrategyName[];
  relayUrls: Record<StrategyName, string[]>;
  connectionMode: ConnectionMode;
  iceServers: IceServerConfig[];
}

export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  enabledStrategies: ["nostr", "torrent", "mqtt"],
  relayUrls: {
    nostr: DEFAULT_RELAY_URLS.nostr,
    torrent: DEFAULT_RELAY_URLS.torrent,
    mqtt: DEFAULT_RELAY_URLS.mqtt, // [] at module load; populated lazily
  },
  connectionMode: "parallel",
  iceServers: DEFAULT_ICE_SERVERS,
};

/** Load mqtt default relay URLs lazily and patch defaults + current settings. */
export async function ensureMqttDefaults(): Promise<void> {
  if (DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt.length > 0) return;
  const urls = await getDefaultMqttRelayUrls();
  DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt = urls;
  // If the user hasn't customized mqtt relays, patch the live signal too
  if (strategySettings.value.relayUrls.mqtt.length === 0) {
    strategySettings.value = {
      ...strategySettings.value,
      relayUrls: { ...strategySettings.value.relayUrls, mqtt: urls },
    };
  }
}

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
        nostr: parsed.relayUrls?.nostr ?? DEFAULT_STRATEGY_SETTINGS.relayUrls.nostr,
        torrent: parsed.relayUrls?.torrent ?? DEFAULT_STRATEGY_SETTINGS.relayUrls.torrent,
        mqtt: parsed.relayUrls?.mqtt ?? DEFAULT_STRATEGY_SETTINGS.relayUrls.mqtt,
      },
      connectionMode:
        parsed.connectionMode === "sequential" ? "sequential" : "parallel",
      iceServers: Array.isArray(parsed.iceServers) ? parsed.iceServers : DEFAULT_ICE_SERVERS,
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
    iceServers: s.iceServers,
  };
}

export function resetStrategySettings(): void {
  strategySettings.value = {
    ...DEFAULT_STRATEGY_SETTINGS,
    relayUrls: { ...DEFAULT_STRATEGY_SETTINGS.relayUrls },
    iceServers: [...DEFAULT_ICE_SERVERS],
  };
}
