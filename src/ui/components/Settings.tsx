import { signal } from "@preact/signals";
import { navigate } from "../router";
import { theme as themePreference, effectiveTheme, type Theme } from "../theme";
import { locale, localePreference, t, type LocalePreference } from "../i18n";
import { configToToml, tomlToConfig } from "../../config-toml";
import { gatherConfig, applyConfig } from "../../config";

const importError = signal("");

export function Settings() {
  return (
    <section aria-label={t("settings.section")}>
      <div class="view-header">
        <button
          onClick={() => navigate("/")}
          aria-label={t("common.backToHome")}
        >
          &larr; {t("common.back")}
        </button>
        <h2>{t("settings.heading")}</h2>
      </div>

      <div class="settings-group">
        <h3>{t("settings.language")}</h3>
        <div class="settings-field">
          <label for="language-select">{t("settings.languageLabel")}</label>
          <select
            id="language-select"
            value={localePreference.value}
            onChange={(e) => {
              localePreference.value = (e.target as HTMLSelectElement).value as LocalePreference;
            }}
          >
            <option value="auto">{t("settings.languageAuto")}</option>
            <option value="en">{t("settings.languageEn")}</option>
            <option value="fr">{t("settings.languageFr")}</option>
            <option value="ar">{t("settings.languageAr")}</option>
          </select>
          <p class="settings-hint">{t("settings.languageCurrent", { lang: locale.value.toUpperCase() })}</p>
        </div>
      </div>

      <div class="settings-group">
        <h3>{t("settings.theme")}</h3>
        <div class="settings-field">
          <label for="theme-select">{t("settings.themeLabel")}</label>
          <select
            id="theme-select"
            value={themePreference.value}
            onChange={(e) => {
              themePreference.value = (e.target as HTMLSelectElement).value as Theme;
            }}
          >
            <option value="auto">{t("settings.themeAuto")}</option>
            <option value="light">{t("settings.themeLight")}</option>
            <option value="dark">{t("settings.themeDark")}</option>
          </select>
          <p class="settings-hint">{t("settings.themeCurrent", { theme: effectiveTheme.value })}</p>
        </div>
      </div>
      <div class="settings-group">
        <h3>{t("settings.webrtc")}</h3>
        <div class="settings-field">
          <p class="settings-hint">{t("settings.webrtcHint")}</p>
          <button
            class="start-btn"
            onClick={() => navigate("/settings/webrtc")}
            aria-label={t("settings.webrtcAria")}
          >
            {t("settings.webrtcOpen")}
          </button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-field" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            class="start-btn"
            onClick={() => {
              const toml = configToToml(gatherConfig());
              const blob = new Blob([toml], { type: "application/toml" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "qrshare-config.toml";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t("settings.exportToml")}
          </button>
          <button
            class="start-btn"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".toml,text/plain";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const config = tomlToConfig(text);
                  applyConfig(config);
                  importError.value = "";
                } catch {
                  importError.value = t("settings.importError");
                }
              };
              input.click();
            }}
          >
            {t("settings.importToml")}
          </button>
        </div>
        {importError.value && (
          <p class="settings-hint" style={{ color: "var(--color-error, #d32f2f)" }}>
            {importError.value}
          </p>
        )}
      </div>
    </section>
  );
}
