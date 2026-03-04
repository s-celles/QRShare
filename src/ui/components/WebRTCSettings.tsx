import { navigate } from "../router";
import { t } from "../i18n";
import {
  strategySettings,
  resetStrategySettings,
  type StrategySettings,
} from "@/webrtc/settings";
import { ALL_STRATEGIES, type StrategyName } from "@/webrtc/strategies";
import type { ConnectionMode } from "@/webrtc/types";

function moveStrategy(list: StrategyName[], index: number, direction: -1 | 1): StrategyName[] {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
  return copy;
}

export function WebRTCSettings() {
  const settings = strategySettings.value;

  const updateSettings = (partial: Partial<StrategySettings>) => {
    strategySettings.value = { ...strategySettings.value, ...partial };
  };

  const toggleStrategy = (name: StrategyName) => {
    const current = settings.enabledStrategies;
    if (current.includes(name)) {
      if (current.length <= 1) return;
      updateSettings({ enabledStrategies: current.filter((s) => s !== name) });
    } else {
      updateSettings({ enabledStrategies: [...current, name] });
    }
  };

  const handleMoveUp = (index: number) => {
    updateSettings({
      enabledStrategies: moveStrategy(settings.enabledStrategies, index, -1),
    });
  };

  const handleMoveDown = (index: number) => {
    updateSettings({
      enabledStrategies: moveStrategy(settings.enabledStrategies, index, 1),
    });
  };

  const handleRelayUrlChange = (strategy: StrategyName, text: string) => {
    const urls = text.split("\n").map((s) => s.trim()).filter(Boolean);
    updateSettings({
      relayUrls: { ...settings.relayUrls, [strategy]: urls },
    });
  };

  return (
    <section aria-label={t("webrtcSettings.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/settings")} aria-label={t("common.backToHome")}>
          &larr; {t("common.back")}
        </button>
        <h2>{t("webrtcSettings.heading")}</h2>
      </div>

      <div class="settings-group">
        <h3>{t("webrtcSettings.connectionMode")}</h3>
        <div class="settings-field">
          <label>
            <input
              type="radio"
              name="connectionMode"
              value="parallel"
              checked={settings.connectionMode === "parallel"}
              onChange={() => updateSettings({ connectionMode: "parallel" as ConnectionMode })}
            />
            {" "}{t("webrtcSettings.modeParallel")}
          </label>
          <p class="settings-hint">{t("webrtcSettings.modeParallelHint")}</p>
        </div>
        <div class="settings-field">
          <label>
            <input
              type="radio"
              name="connectionMode"
              value="sequential"
              checked={settings.connectionMode === "sequential"}
              onChange={() => updateSettings({ connectionMode: "sequential" as ConnectionMode })}
            />
            {" "}{t("webrtcSettings.modeSequential")}
          </label>
          <p class="settings-hint">{t("webrtcSettings.modeSequentialHint")}</p>
        </div>
      </div>

      <div class="settings-group">
        <h3>{t("webrtcSettings.strategies")}</h3>
        {ALL_STRATEGIES.map((name) => {
          const enabled = settings.enabledStrategies.includes(name);
          const index = settings.enabledStrategies.indexOf(name);
          const relayText = (settings.relayUrls[name] ?? []).join("\n");
          return (
            <div class="strategy-item" key={name}>
              <div class="strategy-header">
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleStrategy(name)}
                  />
                  {" "}{name}
                </label>
                {enabled && (
                  <span class="strategy-reorder">
                    <button
                      class="strategy-reorder-btn"
                      onClick={() => handleMoveUp(index)}
                      disabled={index <= 0}
                      aria-label={t("webrtcSettings.moveUp", { strategy: name })}
                    >
                      &uarr;
                    </button>
                    <button
                      class="strategy-reorder-btn"
                      onClick={() => handleMoveDown(index)}
                      disabled={index >= settings.enabledStrategies.length - 1}
                      aria-label={t("webrtcSettings.moveDown", { strategy: name })}
                    >
                      &darr;
                    </button>
                  </span>
                )}
              </div>
              {enabled && (
                <div class="strategy-relays">
                  <label>{t("webrtcSettings.relayUrls")}</label>
                  <textarea
                    rows={3}
                    value={relayText}
                    onInput={(e) => handleRelayUrlChange(name, (e.target as HTMLTextAreaElement).value)}
                    placeholder={t("webrtcSettings.relayUrlsPlaceholder")}
                  />
                  <p class="settings-hint">
                    {name === "torrent"
                      ? t("webrtcSettings.relayUrlsHintTorrent")
                      : t("webrtcSettings.relayUrlsHintDefault")}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        class="strategy-reset-btn"
        onClick={resetStrategySettings}
      >
        {t("webrtcSettings.resetDefaults")}
      </button>
    </section>
  );
}
