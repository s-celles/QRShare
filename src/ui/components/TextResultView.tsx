import { signal } from "@preact/signals";
import { ShareService } from "@/share/service";
import { t } from "../i18n";

const shareService = new ShareService();
const copyFeedback = signal(false);

interface TextResultViewProps {
  text: string;
  filename: string;
}

export function TextResultView({ text, filename }: TextResultViewProps) {
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

  return (
    <div class="text-result-view">
      <h3>{t("text.receivedMessage")}</h3>
      <div class="text-result-content" aria-label={t("text.receivedMessage")}>
        <pre class="text-result-pre">{text}</pre>
      </div>
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
    </div>
  );
}
