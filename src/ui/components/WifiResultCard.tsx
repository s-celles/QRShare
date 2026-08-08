import { useState } from "preact/hooks";
import type { StructuredQR } from "@/qr/structured";
import { ShareService } from "@/share/service";
import { t } from "../i18n";

const shareService = new ShareService();

interface WifiResultCardProps {
  wifi: Extract<StructuredQR, { kind: "wifi" }>;
  onPrint?: () => void;
}

export function WifiResultCard({ wifi, onPrint }: WifiResultCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopyPassword = async () => {
    if (!wifi.password) return;
    const res = await shareService.copyToClipboard(wifi.password);
    if (res.kind === "copied") {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  return (
    <div class="structured-card wifi-card">
      <div class="card-header">
        <span class="card-badge wifi-badge">📶 {t("structured.templateWifi")}</span>
        {wifi.hidden && <span class="card-badge hidden-badge">{t("structured.wifiHidden")}</span>}
      </div>

      <div class="card-main">
        <h4 class="wifi-ssid">{wifi.ssid}</h4>
        <div class="wifi-security-tag">{t("structured.wifiSecurity")}: <strong>{wifi.security}</strong></div>

        {wifi.security !== "nopass" && wifi.password && (
          <div class="wifi-password-box">
            <span class="param-label">{t("structured.wifiPassword")}:</span>
            <span class="password-text">
              {showPassword ? wifi.password : "••••••••••••"}
            </span>
            <button
              class="icon-btn"
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t("structured.wifiHidePassword") : t("structured.wifiShowPassword")}
            >
              {showPassword ? "👁️‍🗨️" : "👁️"}
            </button>
          </div>
        )}
      </div>

      <div class="card-actions">
        {wifi.password && (
          <button class="start-btn copy-btn" onClick={handleCopyPassword}>
            {copyFeedback ? t("structured.wifiPasswordCopied") : t("structured.wifiCopyPassword")}
          </button>
        )}
        <a class="start-btn connect-btn" href={wifi.raw}>
          {t("structured.wifiConnect")}
        </a>
        {onPrint && (
          <button class="start-btn share-action" onClick={onPrint}>
            🖨️ {t("structured.wifiPrintSign")}
          </button>
        )}
      </div>
    </div>
  );
}
