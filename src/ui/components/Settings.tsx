import { navigate } from "../router";
import { theme as themePreference, effectiveTheme, type Theme } from "../theme";
import { locale, localePreference, t, type LocalePreference } from "../i18n";

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
    </section>
  );
}
