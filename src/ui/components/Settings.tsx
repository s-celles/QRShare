import { signal } from "@preact/signals";
import { navigate } from "../router";
import { theme as themePreference, effectiveTheme, type Theme } from "../theme";

// In-memory settings for WebRTC/signaling
export const peerHost = signal("0.peerjs.com");
export const peerPort = signal(443);
export const peerPath = signal("/");
export const peerSecure = signal(true);
export const turnUrl = signal("");
export const turnUsername = signal("");
export const turnCredential = signal("");

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

      <div class="settings-group">
        <h3>PeerJS Server</h3>
        <div class="settings-field">
          <label for="peer-host">Host</label>
          <input
            id="peer-host"
            type="text"
            value={peerHost.value}
            onInput={(e) => { peerHost.value = (e.target as HTMLInputElement).value; }}
          />
        </div>
        <div class="settings-field">
          <label for="peer-port">Port</label>
          <input
            id="peer-port"
            type="number"
            value={peerPort.value}
            onInput={(e) => { peerPort.value = parseInt((e.target as HTMLInputElement).value) || 443; }}
          />
        </div>
        <div class="settings-field">
          <label for="peer-path">Path</label>
          <input
            id="peer-path"
            type="text"
            value={peerPath.value}
            onInput={(e) => { peerPath.value = (e.target as HTMLInputElement).value; }}
          />
        </div>
        <div class="settings-field">
          <label>
            <input
              type="checkbox"
              checked={peerSecure.value}
              onChange={(e) => { peerSecure.value = (e.target as HTMLInputElement).checked; }}
            />
            {" "}Use HTTPS
          </label>
        </div>
      </div>

      <div class="settings-group">
        <h3>TURN Server (optional)</h3>
        <div class="settings-field">
          <label for="turn-url">TURN URL</label>
          <input
            id="turn-url"
            type="text"
            value={turnUrl.value}
            onInput={(e) => { turnUrl.value = (e.target as HTMLInputElement).value; }}
            placeholder="turn:example.com:3478"
          />
        </div>
        <div class="settings-field">
          <label for="turn-username">Username</label>
          <input
            id="turn-username"
            type="text"
            value={turnUsername.value}
            onInput={(e) => { turnUsername.value = (e.target as HTMLInputElement).value; }}
          />
        </div>
        <div class="settings-field">
          <label for="turn-credential">Credential</label>
          <input
            id="turn-credential"
            type="password"
            value={turnCredential.value}
            onInput={(e) => { turnCredential.value = (e.target as HTMLInputElement).value; }}
          />
        </div>
      </div>
    </section>
  );
}
