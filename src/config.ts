import type { AppConfig } from "./config-toml";
import { theme } from "./ui/theme";
import { localePreference } from "./ui/i18n";
import { strategySettings } from "./webrtc/settings";

export function gatherConfig(): AppConfig {
  return {
    app: {
      theme: theme.value,
      language: localePreference.value,
    },
    webrtc: { ...strategySettings.value },
  };
}

export function applyConfig(config: AppConfig): void {
  theme.value = config.app.theme;
  localePreference.value = config.app.language;
  strategySettings.value = {
    enabledStrategies: [...config.webrtc.enabledStrategies],
    relayUrls: {
      nostr: [...config.webrtc.relayUrls.nostr],
      torrent: [...config.webrtc.relayUrls.torrent],
      mqtt: [...config.webrtc.relayUrls.mqtt],
    },
    connectionMode: config.webrtc.connectionMode,
  };
}
