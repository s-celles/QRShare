import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { WebRTCService } from "@/webrtc/service";
import type { TransferProgress, MultiFileProgress } from "@/webrtc/types";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

const progress = signal<TransferProgress | null>(null);
const error = signal<string | null>(null);
const roomIdInput = signal("");
const isConnecting = signal(false);
const isConnected = signal(false);
const isSending = signal(false);
const isComplete = signal(false);
const isScanning = signal(false);
const totalFiles = signal(0);
const currentFileIndex = signal(0);
const selectedFileNames = signal<string[]>([]);
const preloadedFile = signal<{ buffer: ArrayBuffer; filename: string } | null>(
  null,
);

export function WebRTCSenderView() {
  const serviceRef = useRef<WebRTCService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    serviceRef.current = new WebRTCService();
    // Capture pending file from CreatorView
    const pending = pendingFile.value;
    if (pending) {
      preloadedFile.value = pending;
      pendingFile.value = null;
    }
    return () => {
      serviceRef.current?.disconnect();
      preloadedFile.value = null;
      stopScanning();
    };
  }, []);

  const stopScanning = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    isScanning.value = false;
  }, []);

  const startScanning = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      isScanning.value = true;

      await new Promise((r) => requestAnimationFrame(r));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const zbar = await import("@undecaf/zbar-wasm");
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const tick = async () => {
        if (!isScanning.value) return;
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          animFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        try {
          const symbols = await zbar.scanImageData(imageData);
          if (symbols.length > 0) {
            const text = symbols[0].decode();
            if (text) {
              roomIdInput.value = text;
              stopScanning();
              doConnect(text);
              return;
            }
          }
        } catch { /* ignore scan errors */ }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      error.value = "Camera access denied.";
    }
  }, [stopScanning]);

  const doConnect = useCallback(async (id: string) => {
    if (!id.trim()) return;
    if (isConnecting.value) return;
    const svc = serviceRef.current;
    if (!svc) return;

    try {
      error.value = null;
      isConnecting.value = true;
      console.log("[webrtc-sender] Connecting to room:", id.trim());
      await svc.connectToRoom(id.trim());
      console.log("[webrtc-sender] Connected, confirmation code:", svc.confirmationCode.value);
      isConnected.value = true;
    } catch (err) {
      console.error("[webrtc-sender] Connection failed:", err);
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      isConnecting.value = false;
    }
  }, []);

  const handleConnect = useCallback(() => {
    doConnect(roomIdInput.value);
  }, [doConnect]);

  const handleFiles = useCallback(async (files: FileList) => {
    const svc = serviceRef.current;
    if (!svc || files.length === 0) return;

    isSending.value = true;
    selectedFileNames.value = Array.from(files).map((f) => f.name);

    try {
      if (files.length === 1) {
        totalFiles.value = 1;
        currentFileIndex.value = 0;
        await svc.sendFile(files[0], (p) => {
          progress.value = p;
        });
      } else {
        totalFiles.value = files.length;
        await svc.sendFiles(Array.from(files), (p: MultiFileProgress) => {
          currentFileIndex.value = p.currentFileIndex;
          progress.value = p.currentFileProgress;
        });
      }
      isComplete.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
    isSending.value = false;
  }, []);

  const handleSendPreloaded = useCallback(async () => {
    const svc = serviceRef.current;
    const pre = preloadedFile.value;
    if (!svc || !pre) return;

    isSending.value = true;
    selectedFileNames.value = [pre.filename];
    totalFiles.value = 1;
    currentFileIndex.value = 0;

    try {
      const file = new File([pre.buffer], pre.filename, {
        type: "image/png",
      });
      await svc.sendFile(file, (p) => {
        progress.value = p;
      });
      isComplete.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
    isSending.value = false;
  }, []);

  const handleInputChange = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) handleFiles(target.files);
    },
    [handleFiles],
  );

  const cleanup = useCallback(() => {
    serviceRef.current?.disconnect();
    isConnecting.value = false;
    isConnected.value = false;
    isSending.value = false;
    isComplete.value = false;
    progress.value = null;
    error.value = null;
    roomIdInput.value = "";
    totalFiles.value = 0;
    currentFileIndex.value = 0;
    selectedFileNames.value = [];
    preloadedFile.value = null;
    navigate("/");
  }, []);

  const svc = serviceRef.current;
  const code = svc?.confirmationCode.value || "";
  const pct = progress.value
    ? Math.round(
        (progress.value.bytesSent / progress.value.totalBytes) * 100,
      )
    : 0;

  return (
    <section aria-label={t("webrtcSender.section")}>
      <div class="view-header">
        <button onClick={cleanup} aria-label={t("common.backToHome")}>
          {"\u2190 " + t("common.back")}
        </button>
        <h2>{t("webrtcSender.heading")}</h2>
      </div>

      {error.value && (
        <div class="error-msg" role="alert">
          {error.value}
        </div>
      )}

      {!isConnecting.value && !isConnected.value && !isComplete.value && (
        <div class="webrtc-connect">
          {isScanning.value ? (
            <>
              <div class="viewfinder" style={{ width: "min(100%, calc(100dvh - 14rem))", aspectRatio: "1", margin: "0 auto 0.5rem" }}>
                <video ref={videoRef} class="camera-video" playsInline muted aria-label={t("common.cameraFeed")} />
              </div>
              <canvas ref={canvasRef} class="sr-only" aria-hidden="true" />
              <button onClick={stopScanning} class="stop-btn" aria-label={t("common.stop")}>{t("common.cancel")}</button>
            </>
          ) : (
            <>
              <p>{t("webrtcSender.scanOrEnter")}</p>
              <button onClick={startScanning} class="start-btn" style={{ marginBottom: "1rem" }} aria-label={t("webrtcSender.scanQR")}>
                {t("webrtcSender.scanQR")}
              </button>
              <div class="peer-id-input">
                <input
                  type="text"
                  value={roomIdInput.value}
                  onInput={(e) => {
                    roomIdInput.value = (e.target as HTMLInputElement).value;
                  }}
                  placeholder={t("webrtcSender.roomIdPlaceholder")}
                  aria-label={t("webrtcSender.roomIdAria")}
                />
                <button onClick={handleConnect} class="start-btn" aria-label={t("webrtcSender.connectAria")}>
                  {t("common.connect")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isConnecting.value && !isConnected.value && (
        <div class="webrtc-connect">
          <p>{t("webrtcSender.connecting", { roomId: roomIdInput.value })}</p>
          <p class="settings-hint">{t("webrtcSender.discoveringPeer")}</p>
        </div>
      )}

      {isConnected.value && code && !isSending.value && !isComplete.value && (
        <div class="webrtc-confirm">
          <h3>{t("webrtcSender.confirmationCode")}</h3>
          <p class="confirmation-code" aria-label={t("webrtcSender.confirmationCodeAria")}>
            {code}
          </p>
          <p>{t("webrtcSender.verifyCode")}</p>
          <div class="file-select">
            {preloadedFile.value && (
              <button
                class="start-btn"
                onClick={handleSendPreloaded}
                aria-label={t("webrtcSender.sendFile", { filename: preloadedFile.value.filename })}
              >
                {t("webrtcSender.sendFile", { filename: preloadedFile.value.filename })}
              </button>
            )}
            <button
              class={preloadedFile.value ? "start-btn share-action" : "start-btn"}
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("webrtcSender.selectFilesAria")}
            >
              {preloadedFile.value ? t("webrtcSender.chooseDifferent") : t("webrtcSender.selectFiles")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              class="sr-only"
              onChange={handleInputChange}
              aria-label={t("common.fileInput")}
            />
          </div>
        </div>
      )}

      {isSending.value && progress.value && (
        <div class="webrtc-transfer">
          {totalFiles.value > 1 && (
            <p>
              <strong>{t("webrtcSender.fileOf", { current: currentFileIndex.value + 1, total: totalFiles.value })}</strong>
              {selectedFileNames.value[currentFileIndex.value] && (
                <> — {selectedFileNames.value[currentFileIndex.value]}</>
              )}
            </p>
          )}
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("webrtcSender.transferProgress")}
          >
            <div class="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">{t("webrtcSender.progress")}</span>
              <span class="stat-value">{pct}%</span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("webrtcSender.speed")}</span>
              <span class="stat-value">
                {(progress.value.speedBytesPerSec / 1024).toFixed(0)} KB/s
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("webrtcSender.elapsed")}</span>
              <span class="stat-value">
                {(progress.value.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      )}

      {isComplete.value && (
        <div class="webrtc-complete">
          <h3>{t("webrtcSender.transferComplete")}</h3>
          {totalFiles.value > 1 && (
            <p>{t("webrtcSender.filesSent", { count: totalFiles.value })}</p>
          )}
          <button onClick={cleanup} aria-label={t("webrtcSender.doneAria")}>{t("common.done")}</button>
        </div>
      )}
    </section>
  );
}
