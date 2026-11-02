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

  const inputProps = {
    id: "unlock-password",
    class: "creator-input-field",
    value: password,
    onInput: (e: Event) => setPassword((e.target as HTMLInputElement).value),
    placeholder: t("encryption.passwordPlaceholder"),
    disabled: loading,
    autoFocus: true,
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
              {/* Preact 11 types `type` as a discriminated union: one literal per branch.
                  Both branches render the same <input>, which Preact reuses (focus kept). */}
              {showPassword ? (
                <input type="text" {...inputProps} />
              ) : (
                <input type="password" {...inputProps} />
              )}
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
