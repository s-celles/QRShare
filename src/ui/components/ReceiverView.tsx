import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { ShareService } from "@/share/service";
import { isZipBundle, unbundleFiles } from "@/zip/bundle";
import type { DecodeWorkerInput, DecodeWorkerOutput } from "@/workers/types";
import { t } from "../i18n";

interface ReceivedFile {
  name: string;
  size: number;
  url: string;
}

const shareService = new ShareService();

const uniqueSymbols = signal(0);
const neededSymbols = signal(0);
const filename = signal("");
const receivedFileSize = signal(0);
const receivedSha256 = signal("");
const verified = signal(false);
const isScanning = signal(false);
const isComplete = signal(false);
const error = signal<string | null>(null);
const downloadUrl = signal<string | null>(null);
const cameraError = signal<string | null>(null);
const receivedFiles = signal<ReceivedFile[]>([]);

export function ReceiverView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "stop" } satisfies DecodeWorkerInput);
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (downloadUrl.value) {
      URL.revokeObjectURL(downloadUrl.value);
      downloadUrl.value = null;
    }
    for (const f of receivedFiles.value) {
      URL.revokeObjectURL(f.url);
    }
    receivedFiles.value = [];
    isScanning.value = false;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startScanning = useCallback(async () => {
    error.value = null;
    cameraError.value = null;
    isComplete.value = false;
    uniqueSymbols.value = 0;
    neededSymbols.value = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;

      const workerUrl = new URL("decode-worker.js", location.href);
      const worker = new Worker(workerUrl, { type: "module" });
      workerRef.current = worker;

      worker.onerror = (e) => {
        error.value = `Worker error: ${e.message || "failed to load"}`;
        isScanning.value = false;
      };

      worker.onmessage = (e: MessageEvent<DecodeWorkerOutput>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            uniqueSymbols.value = msg.uniqueSymbols;
            neededSymbols.value = msg.neededSymbols;
            break;
          case "metadata":
            filename.value = msg.filename;
            receivedFileSize.value = msg.fileSize;
            break;
          case "complete": {
            isComplete.value = true;
            isScanning.value = false;
            receivedSha256.value = msg.sha256;
            verified.value = msg.verified;

            if (isZipBundle(msg.filename)) {
              // Multi-file bundle: extract individual files
              try {
                const entries = unbundleFiles(new Uint8Array(msg.file));
                const files: ReceivedFile[] = entries.map((entry) => {
                  const blob = new Blob([entry.data as BlobPart]);
                  return {
                    name: entry.name,
                    size: entry.data.length,
                    url: URL.createObjectURL(blob),
                  };
                });
                receivedFiles.value = files;
              } catch {
                error.value = t("receiver.extractError");
              }
            } else {
              // Single file
              const blob = new Blob([msg.file]);
              downloadUrl.value = URL.createObjectURL(blob);
            }

            // Stop camera
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((t) => t.stop());
            }
            break;
          }
          case "error":
            error.value = msg.message;
            break;
        }
      };

      // Set scanning true first so the video element renders in the DOM
      isScanning.value = true;

      // Wait a frame for Preact to render the video element
      await new Promise((r) => requestAnimationFrame(r));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      captureFrames();
    } catch (err) {
      cameraError.value = t("common.cameraAccessDenied");
    }
  }, []);

  const captureFrames = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !workerRef.current) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const tick = () => {
      if (!isScanning.value) return;

      // Skip frames until video stream is producing real dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      workerRef.current?.postMessage({
        type: "frame",
        imageData,
      } satisfies DecodeWorkerInput);

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const progress =
    neededSymbols.value > 0
      ? Math.min(100, (uniqueSymbols.value / neededSymbols.value) * 100)
      : 0;

  return (
    <section aria-label={t("receiver.section")}>
      <div class="view-header">
        <button onClick={() => { cleanup(); navigate("/"); }} aria-label={t("common.backToHome")}>
          {"\u2190 " + t("common.back")}
        </button>
        <h2>{t("receiver.heading")}</h2>
      </div>

      {cameraError.value && (
        <div class="error-msg" role="alert">
          {cameraError.value}
        </div>
      )}

      {!isScanning.value && !isComplete.value && (
        <div class="receiver-setup">
          <p>{t("receiver.setupText")}</p>
          <button class="start-btn" onClick={startScanning} aria-label={t("receiver.startScanningAria")}>
            {t("receiver.startScanning")}
          </button>
        </div>
      )}

      {isScanning.value && (
        <div class="receiver-active">
          <div class="viewfinder" aria-label={t("common.cameraViewfinder")}>
            <video
              ref={videoRef}
              class="camera-video"
              playsInline
              muted
              aria-label={t("common.cameraFeed")}
            />
            <div class="viewfinder-overlay" aria-hidden="true">
              <div class="corner tl" />
              <div class="corner tr" />
              <div class="corner bl" />
              <div class="corner br" />
            </div>
          </div>
          <canvas ref={canvasRef} class="sr-only" aria-hidden="true" />

          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">{t("receiver.symbols")}</span>
              <span class="stat-value">
                {uniqueSymbols.value} / {neededSymbols.value || "?"}
              </span>
            </div>
            {filename.value && (
              <div class="stat">
                <span class="stat-label">{t("receiver.file")}</span>
                <span class="stat-value">{filename.value}</span>
              </div>
            )}
          </div>

          <div
            class="progress-bar"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("receiver.transferProgress")}
          >
            <div class="progress-fill" style={{ width: `${progress}%` }} />
          </div>

          <button class="stop-btn" onClick={cleanup} aria-label={t("receiver.stopScanning")}>
            {t("common.stop")}
          </button>
        </div>
      )}

      {isComplete.value && (
        <div class="receiver-complete">
          <h3>{t("receiver.transferComplete")}</h3>
          <div class="file-info">
            <p>
              <strong>{t("receiver.integrity")}</strong>{" "}
              {verified.value ? (
                <span class="verified">{t("common.verified")}</span>
              ) : (
                <span class="not-verified">
                  {t("receiver.hashWarning")}
                </span>
              )}
            </p>
          </div>

          {receivedFiles.value.length > 0 ? (
            <div class="file-list">
              <p><strong>{t("receiver.filesReceived", { count: receivedFiles.value.length })}</strong></p>
              {receivedFiles.value.map((f) => (
                <div class="file-list-item" key={f.name}>
                  <span class="file-list-name">{f.name}</span>
                  <span class="file-list-size">{(f.size / 1024).toFixed(1)} KB</span>
                  <a href={f.url} download={f.name} class="download-btn">
                    {t("common.download")}
                  </a>
                </div>
              ))}
            </div>
          ) : downloadUrl.value ? (
            <>
              <div class="file-info">
                <p><strong>{t("receiver.fileLabel")}</strong> {filename.value}</p>
                <p><strong>{t("receiver.sizeLabel")}</strong> {(receivedFileSize.value / 1024).toFixed(1)} KB</p>
              </div>
              <a
                href={downloadUrl.value}
                download={filename.value}
                class="download-btn"
              >
                {t("receiver.downloadFile", { filename: filename.value })}
              </a>
              {shareService.isShareSupported() && (
                <button
                  class="start-btn"
                  style={{ marginTop: "0.5rem" }}
                  onClick={async () => {
                    const response = await fetch(downloadUrl.value!);
                    const blob = await response.blob();
                    const file = new File([blob], filename.value, { type: blob.type });
                    await shareService.shareFile(file);
                  }}
                >
                  {t("common.share")}
                </button>
              )}
            </>
          ) : null}

          <button onClick={() => { cleanup(); isComplete.value = false; }} aria-label={t("receiver.receiveAnotherAria")}>
            {t("receiver.receiveAnother")}
          </button>
        </div>
      )}

      {error.value && (
        <div class="error-msg" role="alert">
          {error.value}
        </div>
      )}
    </section>
  );
}
