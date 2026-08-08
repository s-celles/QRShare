import type { StructuredQR } from "@/qr/structured";
import { t } from "../i18n";

interface WifiPrintModalProps {
  wifi: Extract<StructuredQR, { kind: "wifi" }>;
  qrDataUrl: string | null;
  onClose: () => void;
}

export function WifiPrintModal({ wifi, qrDataUrl, onClose }: WifiPrintModalProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal-container print-modal-container" onClick={(e) => e.stopPropagation()}>
        <div class="print-sign-card" id="printable-wifi-sign">
          <div class="sign-header">
            <h3>📶 {t("structured.printTitle")}</h3>
            <p class="sign-subtitle">{t("structured.printScanHint")}</p>
          </div>

          {qrDataUrl && (
            <div class="sign-qr-box">
              <img src={qrDataUrl} alt={t("structured.templateWifi")} class="sign-qr-img" />
            </div>
          )}

          <div class="sign-details">
            <div class="sign-detail-row">
              <span class="sign-label">{t("structured.wifiSsid")}:</span>
              <strong class="sign-value">{wifi.ssid}</strong>
            </div>
            {wifi.password && (
              <div class="sign-detail-row">
                <span class="sign-label">{t("structured.wifiPassword")}:</span>
                <strong class="sign-value">{wifi.password}</strong>
              </div>
            )}
            <div class="sign-detail-row">
              <span class="sign-label">{t("structured.wifiSecurity")}:</span>
              <span class="sign-value">{wifi.security}</span>
            </div>
          </div>
        </div>

        <div class="modal-actions no-print">
          <button class="start-btn copy-btn" onClick={handlePrint}>
            🖨️ {t("structured.printButton")}
          </button>
          <button class="stop-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
