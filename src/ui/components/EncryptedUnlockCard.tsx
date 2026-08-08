import { useState } from "preact/hooks";
import { t } from "../i18n";

interface EncryptedUnlockCardProps {
  onUnlock: (password: string) => Promise<void>;
}

export function EncryptedUnlockCard({ onUnlock }: EncryptedUnlockCardProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setError(null);
    setLoading(true);

    try {
      await onUnlock(password);
    } catch {
      setError(t("encryption.incorrectPassword"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="structured-card encrypted-card">
      <div class="card-header">
        <span class="card-badge encrypted-badge">🔒 {t("encryption.lockedTitle")}</span>
      </div>

      <div class="card-main">
        <p class="locked-hint">{t("encryption.lockedHint")}</p>

        <form onSubmit={handleSubmit} class="unlock-form">
          <div class="creator-param">
            <label htmlFor="unlock-password">{t("encryption.password")}</label>
            <div class="password-input-wrapper">
              <input
                id="unlock-password"
                type={showPassword ? "text" : "password"}
                class="creator-input-field"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                placeholder={t("encryption.passwordPlaceholder")}
                disabled={loading}
                autoFocus
              />
              <button
                type="button"
                class="icon-btn toggle-pass-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("structured.wifiHidePassword") : t("structured.wifiShowPassword")}
              >
                {showPassword ? "👁️‍🗨️" : "👁️"}
              </button>
            </div>
          </div>

          {error && <div class="error-msg" role="alert">{error}</div>}

          <div class="card-actions">
            <button
              type="submit"
              class="start-btn download-action"
              disabled={!password.trim() || loading}
            >
              {loading ? "…" : `🔓 ${t("encryption.decryptButton")}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
