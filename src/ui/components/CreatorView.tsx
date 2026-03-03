import { signal, computed } from "@preact/signals";
import { useCallback, useEffect } from "preact/hooks";
import { navigate } from "../router";
import {
  renderQRCustomToDataURL,
  getByteCapacity,
  getByteCapacityTable,
  type CorrectionLabel,
} from "@/qr/renderer";
import { ShareService } from "@/share/service";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

const shareService = new ShareService();

const inputText = signal("");
const eccLevel = signal<CorrectionLabel>("M");
const autoVersion = signal(true);
const manualVersion = signal(5);

const textBytes = computed(() => new TextEncoder().encode(inputText.value));
const byteLength = computed(() => textBytes.value.byteLength);

const effectiveMaxVersion = computed(() => {
  if (!autoVersion.value) return manualVersion.value;
  // Find the smallest version that fits for auto mode
  const table = getByteCapacityTable();
  const capacities = table[eccLevel.value];
  for (let v = 1; v <= 40; v++) {
    if (capacities[v] >= byteLength.value) return v;
  }
  return 40;
});

const maxCapacity = computed(() =>
  getByteCapacity(
    autoVersion.value ? effectiveMaxVersion.value : manualVersion.value,
    eccLevel.value,
  ),
);

const isOverCapacity = computed(() => {
  if (byteLength.value === 0) return false;
  return byteLength.value > maxCapacity.value;
});

const qrDataUrl = computed(() => {
  if (byteLength.value === 0 || isOverCapacity.value) return null;
  try {
    return renderQRCustomToDataURL(textBytes.value, {
      eccLevel: eccLevel.value,
      autoVersion: autoVersion.value,
      manualVersion: autoVersion.value ? undefined : manualVersion.value,
    });
  } catch {
    return null;
  }
});

export function CreatorView() {
  const handleTextInput = useCallback((e: Event) => {
    inputText.value = (e.target as HTMLTextAreaElement).value;
  }, []);

  const handleEccChange = useCallback((e: Event) => {
    eccLevel.value = (e.target as HTMLSelectElement).value as CorrectionLabel;
  }, []);

  const handleVersionModeChange = useCallback((e: Event) => {
    autoVersion.value = (e.target as HTMLSelectElement).value === "auto";
  }, []);

  const handleManualVersionChange = useCallback((e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (val >= 1 && val <= 40) {
      manualVersion.value = val;
    }
  }, []);

  const handleDownload = useCallback(() => {
    const dataUrl = qrDataUrl.value;
    if (!dataUrl) return;

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "qrcode.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const dataUrlToBlob = useCallback(async (): Promise<Blob | null> => {
    const dataUrl = qrDataUrl.value;
    if (!dataUrl) return null;
    const res = await fetch(dataUrl);
    return res.blob();
  }, []);

  const handleShare = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const file = new File([blob], "qrcode.png", { type: "image/png" });
    await shareService.shareFile(file);
  }, [dataUrlToBlob]);

  const handleSendQR = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    pendingFile.value = { buffer, filename: "qrcode.png" };
    navigate("/send/qr");
  }, [dataUrlToBlob]);

  const handleSendWebRTC = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    pendingFile.value = { buffer, filename: "qrcode.png" };
    navigate("/send/webrtc");
  }, [dataUrlToBlob]);

  const cleanup = useCallback(() => {
    inputText.value = "";
    eccLevel.value = "M";
    autoVersion.value = true;
    manualVersion.value = 5;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return (
    <section aria-label={t("creator.section")}>
      <div class="view-header">
        <button
          onClick={() => {
            cleanup();
            navigate("/");
          }}
          aria-label={t("common.backToHome")}
        >
          ← {t("common.back")}
        </button>
        <h2>{t("creator.heading")}</h2>
      </div>

      <div class="creator-content">
        <div class="creator-input">
          <label htmlFor="qr-text">{t("creator.contentLabel")}</label>
          <textarea
            id="qr-text"
            class="creator-textarea"
            value={inputText.value}
            onInput={handleTextInput}
            placeholder={t("creator.placeholder")}
            rows={4}
          />
        </div>

        <div class="creator-params">
          <div class="creator-param">
            <label htmlFor="ecc-level">{t("creator.errorCorrection")}</label>
            <select
              id="ecc-level"
              value={eccLevel.value}
              onChange={handleEccChange}
            >
              <option value="L">{t("creator.eccL")}</option>
              <option value="M">{t("creator.eccM")}</option>
              <option value="Q">{t("creator.eccQ")}</option>
              <option value="H">{t("creator.eccH")}</option>
            </select>
          </div>

          <div class="creator-param">
            <label htmlFor="version-mode">{t("creator.version")}</label>
            <select
              id="version-mode"
              value={autoVersion.value ? "auto" : "manual"}
              onChange={handleVersionModeChange}
            >
              <option value="auto">{t("creator.versionAuto")}</option>
              <option value="manual">{t("creator.versionManual")}</option>
            </select>
          </div>

          {!autoVersion.value && (
            <div class="creator-param">
              <label htmlFor="manual-version">
                {t("creator.versionRange")}
              </label>
              <input
                id="manual-version"
                type="number"
                min={1}
                max={40}
                value={manualVersion.value}
                onInput={handleManualVersionChange}
              />
            </div>
          )}

          <div class="creator-capacity">
            <span class="param-label">{t("creator.payload")}</span>
            <span
              class={`param-value ${isOverCapacity.value ? "over-capacity" : ""}`}
            >
              {byteLength.value} / {maxCapacity.value} {t("creator.bytes")}
              {autoVersion.value && byteLength.value > 0 && (
                <> (v{effectiveMaxVersion.value})</>
              )}
              {!autoVersion.value && <> (v{manualVersion.value})</>}
            </span>
          </div>
        </div>

        {isOverCapacity.value && (
          <div class="error-msg" role="alert">
            {t("creator.overCapacity")}
          </div>
        )}

        {byteLength.value === 0 && (
          <div class="creator-placeholder">
            <p>{t("creator.emptyState")}</p>
          </div>
        )}

        {qrDataUrl.value && (
          <div class="qr-display">
            <img
              src={qrDataUrl.value}
              alt={t("creator.qrAlt")}
              class="qr-image"
            />
          </div>
        )}

        {qrDataUrl.value && (
          <div class="share-actions">
            <button class="start-btn download-action" onClick={handleDownload}>
              {t("creator.downloadPNG")}
            </button>
            {shareService.isShareSupported() && (
              <button class="start-btn share-action" onClick={handleShare}>
                {t("common.share")}
              </button>
            )}
            <button class="start-btn share-action" onClick={handleSendQR}>
              {t("common.sendQR")}
            </button>
            <button class="start-btn share-action" onClick={handleSendWebRTC}>
              {t("common.sendWebRTC")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
