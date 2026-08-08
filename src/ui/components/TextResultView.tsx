import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { parseStructuredQR } from "@/qr/structured";
import { renderQRCustomToDataURL } from "@/qr/renderer";
import { ShareService } from "@/share/service";
import { WifiResultCard } from "./WifiResultCard";
import { ContactResultCard } from "./ContactResultCard";
import { WifiPrintModal } from "./WifiPrintModal";
import { t } from "../i18n";

const shareService = new ShareService();
const copyFeedback = signal(false);

interface TextResultViewProps {
  text: string;
  filename: string;
}

export function TextResultView({ text, filename }: TextResultViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const structured = parseStructuredQR(text);

  const handleCopy = async () => {
    const result = await shareService.copyToClipboard(text);
    if (result.kind === "copied") {
      copyFeedback.value = true;
      setTimeout(() => {
        copyFeedback.value = false;
      }, 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    await shareService.shareText(text, filename);
  };

  const wifiQrDataUrl = structured.kind === "wifi" ? (() => {
    try {
      return renderQRCustomToDataURL(new TextEncoder().encode(text), {
        eccLevel: "M",
        autoVersion: true,
      });
    } catch {
      return null;
    }
  })() : null;

  return (
    <div class="text-result-view">
      <h3>{t("text.receivedMessage")}</h3>

      {structured.kind === "wifi" && !showRaw && (
        <WifiResultCard
          wifi={structured}
          onPrint={() => setShowPrintModal(true)}
        />
      )}

      {structured.kind === "contact" && !showRaw && (
        <ContactResultCard contact={structured} />
      )}

      {(structured.kind === "text" || structured.kind === "url" || showRaw) && (
        <div class="text-result-content" aria-label={t("text.receivedMessage")}>
          <pre class="text-result-pre">{text}</pre>
        </div>
      )}

      {(structured.kind === "wifi" || structured.kind === "contact") && (
        <div class="card-toggle-row">
          <button class="icon-btn-text" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? t("structured.toggleStructured") : t("structured.toggleRaw")}
          </button>
        </div>
      )}

      <div class="text-result-actions">
        <button class="copy-btn" onClick={handleCopy} aria-label={t("text.copyToClipboard")}>
          {copyFeedback.value ? t("text.copied") : t("text.copyToClipboard")}
        </button>
        <button class="start-btn share-action" onClick={handleDownload} aria-label={t("text.downloadAsFile")}>
          {t("text.downloadAsFile")}
        </button>
        {shareService.isShareSupported() && (
          <button class="start-btn share-action" onClick={handleShare} aria-label={t("text.shareText")}>
            {t("text.shareText")}
          </button>
        )}
      </div>

      {showPrintModal && structured.kind === "wifi" && (
        <WifiPrintModal
          wifi={structured}
          qrDataUrl={wifiQrDataUrl}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
}
