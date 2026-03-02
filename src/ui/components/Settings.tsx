import { navigate } from "../router";
import { theme as themePreference, effectiveTheme, type Theme } from "../theme";

export function Settings() {
  return (
    <section aria-label="Settings">
      <div class="view-header">
        <button
          onClick={() => navigate("/")}
          aria-label="Back to home"
        >
          &larr; Back
        </button>
        <h2>Settings</h2>
      </div>

      <div class="settings-group">
        <h3>Theme</h3>
        <div class="settings-field">
          <label for="theme-select">Theme preference</label>
          <select
            id="theme-select"
            value={themePreference.value}
            onChange={(e) => {
              themePreference.value = (e.target as HTMLSelectElement).value as Theme;
            }}
          >
            <option value="auto">Auto (system)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <p class="settings-hint">Current: {effectiveTheme.value}</p>
        </div>
      </div>
    </section>
  );
}
