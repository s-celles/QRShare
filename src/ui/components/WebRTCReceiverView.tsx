import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { WebRTCService } from "@/webrtc/service";
import { renderQRToDataURL } from "@/qr/renderer";
import { hashSha256 } from "@/crypto/hash";
import { ShareService } from "@/share/service";
import type { TransferMetadata, TransferProgress, BatchMetadata } from "@/webrtc/types";
import { t } from "../i18n";

const copyRoomIdFeedback = signal(false);

interface ReceivedFile {
  meta: TransferMetadata;
  url: string;
  verified: boolean;
}

const shareService = new ShareService();

const roomIdQR = signal<string | null>(null);
const roomId = signal("");
const progress = signal<TransferProgress | null>(null);
const metadata = signal<TransferMetadata | null>(null);
const downloadUrl = signal<string | null>(null);
const verified = signal(false);
const error = signal<string | null>(null);
const isWaiting = signal(false);
const isComplete = signal(false);
const batchTotal = signal(0);
const receivedFiles = signal<ReceivedFile[]>([]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function WebRTCReceiverView() {
  const serviceRef = useRef<WebRTCService | null>(null);

  const cleanup = useCallback(() => {
    serviceRef.current?.disconnect();
    if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
    for (const f of receivedFiles.value) {
      URL.revokeObjectURL(f.url);
    }
    roomIdQR.value = null;
    roomId.value = "";
    progress.value = null;
    metadata.value = null;
    downloadUrl.value = null;
    error.value = null;
    isWaiting.value = false;
    isComplete.value = false;
    batchTotal.value = 0;
    receivedFiles.value = [];
    copyRoomIdFeedback.value = false;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startReceiving = useCallback(async () => {
    const svc = new WebRTCService();
    serviceRef.current = svc;

    svc.onProgress((p) => {
      progress.value = p;
    });

    svc.onBatchStarted((batch: BatchMetadata) => {
      batchTotal.value = batch.totalFiles;
      console.log("[webrtc-receiver] Batch started:", batch);
    });

    svc.onFileReceived(async (meta, data) => {
      metadata.value = meta;

      // Verify SHA-256
      const hash = await hashSha256(data);
      const isVerified = toHex(hash) === meta.sha256;

      if (batchTotal.value > 0) {
        // Multi-file: accumulate
        const blob = new Blob([data as BlobPart]);
        receivedFiles.value = [
          ...receivedFiles.value,
          { meta, url: URL.createObjectURL(blob), verified: isVerified },
        ];
      } else {
        // Single file
        verified.value = isVerified;
        const blob = new Blob([data as BlobPart]);
        downloadUrl.value = URL.createObjectURL(blob);
        isComplete.value = true;
        isWaiting.value = false;
      }
    });

    svc.onBatchComplete(() => {
      isComplete.value = true;
      isWaiting.value = false;
    });

    try {
      error.value = null;
      console.log("[webrtc-receiver] Creating receiver...");
      const result = await svc.createReceiver();
      console.log("[webrtc-receiver] Room created, ID:", result.roomId);
      roomId.value = result.roomId;
      isWaiting.value = true;

      // Render room ID as QR code
      const roomIdBytes = new TextEncoder().encode(result.roomId);
      roomIdQR.value = renderQRToDataURL(roomIdBytes, "balanced");
    } catch (err) {
      console.error("[webrtc-receiver] Error:", err);
      error.value = err instanceof Error ? err.message : String(err);
    }
  }, []);

  const code = serviceRef.current?.getConfirmationCode() || "";
  const state = serviceRef.current?.state.value || "idle";
  const pct = progress.value
    ? Math.round(
        (progress.value.bytesSent / progress.value.totalBytes) * 100,
      )
    : 0;

  return (
    <section aria-label={t("webrtcReceiver.section")}>
      <div class="view-header">
        <button
          onClick={() => {
            cleanup();
            navigate("/");
          }}
          aria-label={t("common.backToHome")}
        >
          {"\u2190 " + t("common.back")}
        </button>
        <h2>{t("webrtcReceiver.heading")}</h2>
      </div>

      {error.value && (
        <div class="error-msg" role="alert">
          {error.value}
        </div>
      )}

      {!isWaiting.value && !isComplete.value && (
        <div class="receiver-setup">
          <p>
            {t("webrtcReceiver.setupText")}
          </p>
          <button class="start-btn" onClick={startReceiving} aria-label={t("webrtcReceiver.startReceivingAria")}>
            {t("webrtcReceiver.startReceiving")}
          </button>
        </div>
      )}

      {isWaiting.value && state === "waiting" && (
        <div class="webrtc-waiting">
          <h3>{t("webrtcReceiver.waitingForSender")}</h3>
          {roomIdQR.value && (
            <div class="qr-display">
              <img
                src={roomIdQR.value}
                alt={t("webrtcReceiver.roomIdQRAlt")}
                class="qr-image"
              />
            </div>
          )}
          <p class="peer-id-text">
            {t("webrtcReceiver.roomIdLabel")} <code>{roomId.value}</code>
          </p>
          <p>{t("webrtcReceiver.showQR")}</p>
          <div class="share-actions">
            <button
              class="copy-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(roomId.value);
                  copyRoomIdFeedback.value = true;
                  setTimeout(() => { copyRoomIdFeedback.value = false; }, 2000);
                } catch { /* clipboard not available */ }
              }}
              aria-label={t("webrtcReceiver.copyRoomId")}
            >
              {copyRoomIdFeedback.value ? t("webrtcReceiver.copied") : t("webrtcReceiver.copyRoomId")}
            </button>
            {shareService.isShareSupported() && (
              <button
                class="start-btn share-action"
                onClick={() => {
                  navigator.share({ title: "QRShare", text: roomId.value }).catch(() => {});
                }}
                aria-label={t("webrtcReceiver.shareRoomId")}
              >
                {t("webrtcReceiver.shareRoomId")}
              </button>
            )}
          </div>
        </div>
      )}

      {state === "connecting" && (
        <div class="webrtc-connect">
          <p>{t("webrtcReceiver.connecting")}</p>
        </div>
      )}

      {state === "confirming" && (
        <div class="webrtc-confirm">
          <h3>{t("webrtcReceiver.confirmationCode")}</h3>
          <p class="confirmation-code" aria-label={t("webrtcReceiver.confirmationCodeAria")}>
            {code}
          </p>
          <p>
            {t("webrtcReceiver.verifyCode")}
          </p>
        </div>
      )}

      {state === "transferring" && progress.value && (
        <div class="webrtc-transfer">
          <h3>{batchTotal.value > 1 ? t("webrtcReceiver.receivingFileOf", { current: receivedFiles.value.length + 1, total: batchTotal.value }) : t("webrtcReceiver.receiving")}</h3>
          {metadata.value && <p>{t("webrtcReceiver.fileLabel", { filename: metadata.value.filename })}</p>}
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("webrtcReceiver.receptionProgress")}
          >
            <div class="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">{t("webrtcReceiver.progress")}</span>
              <span class="stat-value">{pct}%</span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("webrtcReceiver.speed")}</span>
              <span class="stat-value">
                {(progress.value.speedBytesPerSec / 1024).toFixed(0)} KB/s
              </span>
            </div>
          </div>
        </div>
      )}

      {isComplete.value && receivedFiles.value.length > 0 && (
        <div class="receiver-complete">
          <h3>{t("webrtcReceiver.transferComplete")}</h3>
          <p><strong>{t("webrtcReceiver.filesReceived", { count: receivedFiles.value.length })}</strong></p>
          <div class="file-list">
            {receivedFiles.value.map((f) => (
              <div class="file-list-item" key={f.meta.sha256}>
                <div>
                  <span class="file-list-name">{f.meta.filename}</span>
                  <span class="file-list-size"> ({(f.meta.fileSize / 1024).toFixed(1)} KB)</span>
                  {f.verified ? (
                    <span class="verified"> {t("common.verified")}</span>
                  ) : (
                    <span class="not-verified"> {t("common.hashMismatch")}</span>
                  )}
                </div>
                <a href={f.url} download={f.meta.filename} class="download-btn">
                  {t("common.download")}
                </a>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              cleanup();
              isComplete.value = false;
            }}
            aria-label={t("webrtcReceiver.receiveMoreAria")}
          >
            {t("webrtcReceiver.receiveAnother")}
          </button>
        </div>
      )}

      {isComplete.value && receivedFiles.value.length === 0 && metadata.value && (
        <div class="receiver-complete">
          <h3>{t("webrtcReceiver.transferComplete")}</h3>
          <div class="file-info">
            <p>
              <strong>{t("receiver.fileLabel")}</strong> {metadata.value.filename}
            </p>
            <p>
              <strong>{t("receiver.sizeLabel")}</strong>{" "}
              {(metadata.value.fileSize / 1024).toFixed(1)} KB
            </p>
            <p>
              <strong>{t("webrtcReceiver.sha256")}</strong>{" "}
              <code>{metadata.value.sha256.slice(0, 16)}...</code>
            </p>
            <p>
              <strong>{t("webrtcReceiver.integrity")}</strong>{" "}
              {verified.value ? (
                <span class="verified">{t("common.verified")}</span>
              ) : (
                <span class="not-verified">
                  {t("common.hashMismatch")}
                </span>
              )}
            </p>
          </div>
          {downloadUrl.value && (
            <>
              <a
                href={downloadUrl.value}
                download={metadata.value.filename}
                class="download-btn"
              >
                {t("webrtcReceiver.downloadFile", { filename: metadata.value.filename })}
              </a>
              {shareService.isShareSupported() && (
                <button
                  class="start-btn"
                  style={{ marginTop: "0.5rem" }}
                  onClick={async () => {
                    const response = await fetch(downloadUrl.value!);
                    const blob = await response.blob();
                    const file = new File([blob], metadata.value!.filename, { type: blob.type });
                    await shareService.shareFile(file);
                  }}
                >
                  {t("common.share")}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              cleanup();
              isComplete.value = false;
            }}
            aria-label={t("webrtcReceiver.receiveAnotherAria")}
          >
            {t("webrtcReceiver.receiveAnother")}
          </button>
        </div>
      )}
    </section>
  );
}
