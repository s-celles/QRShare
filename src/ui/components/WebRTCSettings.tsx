import { useEffect } from "preact/hooks";
import { navigate } from "../router";
import { t } from "../i18n";
import {
  strategySettings,
  resetStrategySettings,
  ensureMqttDefaults,
  type StrategySettings,
} from "@/webrtc/settings";
import { ALL_STRATEGIES, type StrategyName } from "@/webrtc/strategies";
import type { ConnectionMode, IceServerConfig } from "@/webrtc/types";

function moveStrategy(list: StrategyName[], index: number, direction: -1 | 1): StrategyName[] {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
  return copy;
}

export function WebRTCSettings() {
  useEffect(() => { ensureMqttDefaults(); }, []);

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
                    {t(`webrtcSettings.relayUrlsHint.${name}`)}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <IceServersGroup settings={settings} updateSettings={updateSettings} />

      <button
        class="strategy-reset-btn"
        onClick={resetStrategySettings}
      >
        {t("webrtcSettings.resetDefaults")}
      </button>
    </section>
  );
}

function IceServersGroup({
  settings,
  updateSettings,
}: {
  settings: StrategySettings;
  updateSettings: (partial: Partial<StrategySettings>) => void;
}) {
  const iceServers = settings.iceServers ?? [];
  const getUrl = (s: IceServerConfig) =>
    Array.isArray(s.urls) ? s.urls[0] : s.urls;

  const stunServers = iceServers.filter((s) => getUrl(s).startsWith("stun:"));
  const turnServers = iceServers.filter((s) => {
    const u = getUrl(s);
    return !u.startsWith("stun:");
  });

  const stunText = stunServers.map((s) => getUrl(s)).join("\n");

  const handleStunChange = (text: string) => {
    const newStun: IceServerConfig[] = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => ({ urls: url }));
    updateSettings({ iceServers: [...newStun, ...turnServers] });
  };

  const handleTurnChange = (index: number, field: string, value: string) => {
    const updated = turnServers.map((s, i) =>
      i === index ? { ...s, [field]: value || undefined } : s,
    );
    updateSettings({ iceServers: [...stunServers, ...updated] });
  };

  const handleTurnUrlChange = (index: number, value: string) => {
    const updated = turnServers.map((s, i) =>
      i === index ? { ...s, urls: value } : s,
    );
    updateSettings({ iceServers: [...stunServers, ...updated] });
  };

  const addTurn = () => {
    updateSettings({
      iceServers: [...iceServers, { urls: "", username: "", credential: "" }],
    });
  };

  const removeTurn = (index: number) => {
    const updated = turnServers.filter((_, i) => i !== index);
    updateSettings({ iceServers: [...stunServers, ...updated] });
  };

  return (
    <div class="settings-group">
      <h3>{t("webrtcSettings.iceServers")}</h3>
      <p class="settings-hint">{t("webrtcSettings.iceServersHint")}</p>

      <div class="strategy-relays">
        <label>{t("webrtcSettings.stunServers")}</label>
        <textarea
          rows={2}
          value={stunText}
          onInput={(e) => handleStunChange((e.target as HTMLTextAreaElement).value)}
          placeholder={t("webrtcSettings.stunPlaceholder")}
        />
      </div>

      {turnServers.map((turn, i) => (
        <div class="turn-server-item" key={i}>
          <div class="settings-field">
            <label>{t("webrtcSettings.turnUrl")}</label>
            <input
              type="text"
              value={getUrl(turn)}
              onInput={(e) => handleTurnUrlChange(i, (e.target as HTMLInputElement).value)}
              placeholder={t("webrtcSettings.turnUrlPlaceholder")}
            />
          </div>
          <div class="turn-credentials">
            <div class="settings-field">
              <label>{t("webrtcSettings.turnUsername")}</label>
              <input
                type="text"
                value={turn.username ?? ""}
                onInput={(e) => handleTurnChange(i, "username", (e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="settings-field">
              <label>{t("webrtcSettings.turnPassword")}</label>
              <input
                type="password"
                value={turn.credential ?? ""}
                onInput={(e) => handleTurnChange(i, "credential", (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <button class="turn-remove-btn" onClick={() => removeTurn(i)}>
            {t("webrtcSettings.removeTurn")}
          </button>
        </div>
      ))}

      <button class="turn-add-btn" onClick={addTurn}>
        + {t("webrtcSettings.addTurn")}
      </button>
    </div>
  );
}
