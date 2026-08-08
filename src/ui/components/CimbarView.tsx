import { useEffect, useRef, useState } from "preact/hooks";
import { navigate, hashParams } from "../router";
import { pendingFile, pendingText, TEXT_FILENAME, TEXT_MIME_TYPE } from "../shared-file";
import { t } from "../i18n";
import { ShareService } from "@/share/service";
import { TextResultView } from "./TextResultView";
import { TransferSummary } from "./TransferSummary";
import { FilePreview } from "./FilePreview";
import { SpeedGraph } from "./SpeedGraph";

type CimbarMode = 68 | 67 | 66;

type CimbarReceiveStats = {
  expectedSize: number;
  receivedBytes: number;
  scannedFrames: number;
  detectedFrames: number;
  detectionRate: number;
  elapsedMs: number;
  speedBytesPerSec: number;
};

const emptyReceiveStats: CimbarReceiveStats = {
  expectedSize: 0, receivedBytes: 0, scannedFrames: 0, detectedFrames: 0,
  detectionRate: 0, elapsedMs: 0, speedBytesPerSec: 0,
};

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

const workerUrl = (name: string) => new URL(`cimbar/${name}`, window.location.href).toString();
const shareService = new ShareService();

function preparedContent(): File | null {
  const pending = pendingFile.value;
  const text = pendingText.value;
  if (pending) {
    pendingFile.value = null;
    return new File([pending.buffer], pending.filename);
  }
  if (text) {
    pendingText.value = null;
    return new File([text], TEXT_FILENAME, { type: TEXT_MIME_TYPE });
  }
  return null;
}

export function CimbarView({ direction }: { direction: "send" | "receive" }) {
  return direction === "send" ? <CimbarSender /> : <CimbarReceiver />;
}

function CimbarHeader({ direction }: { direction: "send" | "receive" }) {
  return (
    <>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t(`cimbar.${direction}Heading`)}</h2>
      </div>
      <p class="settings-hint">{t("cimbar.experimentalHint")}</p>
    </>
  );
}

function CimbarSender() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [file, setFile] = useState<File | null>(() => preparedContent());
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [fps, setFps] = useState(10);
  const [mode, setMode] = useState<CimbarMode>(68);
  const [aspect, setAspect] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.transferControlToOffscreen !== "function") {
      setError(t("cimbar.offscreenUnsupported"));
      return;
    }
    const worker = new Worker(workerUrl("cimbar-send-worker.js"));
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") setReady(true);
      else if (message.type === "active") setActive(true);
      else if (message.type === "aspect") setAspect(Number(message.value) || 1);
      else if (message.type === "wake-lock") navigator.wakeLock?.request("screen").catch(() => {});
      else if (message.type === "error") setError(message.message);
    };
    worker.onerror = (event) => setError(event.message);
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
    return () => worker.terminate();
  }, []);

  const start = () => {
    if (!file || !ready) return;
    setError("");
    workerRef.current?.postMessage({ type: "start", file, fps, mode });
  };

  return (
    <section aria-label={t("cimbar.sendSection")}>
      <CimbarHeader direction="send" />
      <div class="cimbar-controls">
        <label>{t("cimbar.file")}
          <input type="file" onChange={(event) => {
            setFile((event.target as HTMLInputElement).files?.[0] ?? null);
            setActive(false);
          }} />
        </label>
        {file && <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>}
        <label>{t("cimbar.mode")}
          <select value={mode} onChange={(event) => setMode(Number((event.target as HTMLSelectElement).value) as CimbarMode)}>
            <option value={68}>B</option><option value={67}>Bm</option><option value={66}>Bu</option>
          </select>
        </label>
        <label>{t("cimbar.fps", { fps })}
          <input type="range" min={5} max={20} step={5} value={fps} onInput={(event) => {
            const value = Number((event.target as HTMLInputElement).value);
            setFps(value);
            workerRef.current?.postMessage({ type: "fps", fps: value });
          }} />
        </label>
        <button class="start-btn" disabled={!file || !ready} onClick={start}>
          {!ready ? t("cimbar.loading") : active ? t("cimbar.sending") : t("cimbar.startSending")}
        </button>
      </div>
      {error && <div class="error-msg" role="alert">{error}</div>}
      <div class="cimbar-canvas-wrap" style={{ display: active ? "" : "none" }}>
        <canvas ref={canvasRef} class="cimbar-canvas" style={{ aspectRatio: String(aspect) }} />
      </div>
    </section>
  );
}

function CimbarReceiver() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef(0);
  const resultUrlRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [detected, setDetected] = useState(false);
  const [mode, setMode] = useState<CimbarMode>(68);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<CimbarReceiveStats>(emptyReceiveStats);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState<"" | "shared" | "cancelled" | "unsupported">("");
  const [result, setResult] = useState<{
    filename: string;
    url: string;
    file: File;
    text: string | null;
    sha256: string;
    verified: boolean | null;
  } | null>(null);

  const instantSpeedRef = useRef(0);
  const speedHistory = useRef<number[]>([]);
  const lastStatsRef = useRef<CimbarReceiveStats>(emptyReceiveStats);
  const lastTimeRef = useRef(Date.now());

  useEffect(() => {
    const worker = new Worker(workerUrl("cimbar-receive-worker.js"));
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") setReady(true);
      else if (message.type === "frame-done") busyRef.current = false;
      else if (message.type === "frame" && message.detected) setDetected(true);
      else if (message.type === "stats") {
        setDetected(message.detectedFrames > 0);
        setProgress(message.progress * 100);
        
        // Calculate instant speed based on received bytes (which uses maxProgress)
        const now = Date.now();
        const timeDiff = (now - lastTimeRef.current) / 1000;
        if (timeDiff >= 0.5) {
          const bytesDiff = message.receivedBytes - lastStatsRef.current.receivedBytes;
          const instSpeed = bytesDiff > 0 ? bytesDiff / timeDiff : 0;
          instantSpeedRef.current = instSpeed;
          speedHistory.current = [...speedHistory.current.slice(-60), instSpeed];
          lastTimeRef.current = now;
          lastStatsRef.current = message;
        }
        
        setStats(message);
      } else if (message.type === "complete") {
        const isText = message.filename === TEXT_FILENAME;
        const file = new File([message.file], message.filename, {
          type: isText ? TEXT_MIME_TYPE : "application/octet-stream",
        });
        const url = URL.createObjectURL(file);
        if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = url;
        setResult({
          filename: message.filename,
          url,
          file,
          text: isText ? new TextDecoder().decode(message.file) : null,
          sha256: message.sha256 || "",
          verified: typeof message.verified === "boolean" ? message.verified : null,
        });
        setProgress(100);
        stopCamera();
      } else if (message.type === "error") setError(message.message);
    };
    worker.onerror = (event) => setError(event.message);
    return () => {
      worker.terminate();
      stopCamera();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const stopCamera = () => {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const pump = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    if (!busyRef.current && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(video, 0, 0);
      const image = context?.getImageData(0, 0, canvas.width, canvas.height);
      if (image) {
        busyRef.current = true;
        workerRef.current?.postMessage({
          type: "frame", pixels: image.data.buffer, width: image.width, height: image.height, mode,
        }, [image.data.buffer]);
      }
    }
    animationRef.current = requestAnimationFrame(pump);
  };

  const startCamera = async () => {
    try {
      setError("");
      setProgress(0);
      setStats(emptyReceiveStats);
      setDetected(false);
      speedHistory.current = [];
      instantSpeedRef.current = 0;
      lastTimeRef.current = Date.now();
      lastStatsRef.current = emptyReceiveStats;
      workerRef.current?.postMessage({ type: "reset" });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
      });
      streamRef.current = stream;
      // Mount the camera frame only after the user explicitly starts it.
      setScanning(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const video = videoRef.current;
      if (!video) throw new Error("CIMBAR camera view is unavailable");
      video.srcObject = stream;
      await video.play();
      animationRef.current = requestAnimationFrame(pump);
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setScanning(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    if (hashParams.value.get("autostart") === "1" && ready && !scanning) void startCamera();
  }, [ready]);

  return (
    <section aria-label={t("cimbar.receiveSection")}>
      <CimbarHeader direction="receive" />
      <div class="cimbar-controls">
        <label>{t("cimbar.mode")}
          <select value={mode} disabled={scanning} onChange={(event) => setMode(Number((event.target as HTMLSelectElement).value) as CimbarMode)}>
            <option value={68}>B</option><option value={67}>Bm</option><option value={66}>Bu</option>
          </select>
        </label>
        {!scanning ? <button class="start-btn" disabled={!ready} onClick={startCamera}>{ready ? t("cimbar.startReceiving") : t("cimbar.loading")}</button>
          : <button class="stop-btn" onClick={stopCamera}>{t("common.stop")}</button>}
      </div>
      {error && <div class="error-msg" role="alert">{error}</div>}
      {scanning && !result && (
        <div class={`cimbar-camera ${detected ? "detected" : ""}`}>
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} class="sr-only" />
        </div>
      )}
      {scanning && !result && (
        <>
          <div class="progress-container">
            <div class="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div class="transfer-stats" aria-live="polite">
            <div class="stat"><span class="stat-label">{t("cimbar.progress") || "Progress"}</span><span class="stat-value">{progress.toFixed(1)}%</span></div>
            <div class="stat"><span class="stat-label">{t("cimbar.receivedSize") || "Downloaded"}</span><span class="stat-value">{stats.expectedSize > 0 ? `${formatBytes(stats.receivedBytes)} / ${formatBytes(stats.expectedSize)}` : t("cimbar.waitingMetadata")}</span></div>
            <div class="stat"><span class="stat-label">{t("receiver.speed") || "Avg Speed"}</span><span class="stat-value">{formatBytes(stats.speedBytesPerSec)}/s</span></div>
            <div class="stat"><span class="stat-label">{t("receiver.instantSpeed") || "Instant Speed"}</span><span class="stat-value">{formatBytes(instantSpeedRef.current)}/s</span></div>
            <div class="stat"><span class="stat-label">{t("cimbar.elapsed") || "Elapsed"}</span><span class="stat-value">{(stats.elapsedMs / 1000).toFixed(1)} s</span></div>
            <div class="stat"><span class="stat-label">{t("cimbar.detectedFrames") || "Detected"}</span><span class="stat-value">{stats.detectedFrames} / {stats.scannedFrames} ({Math.round(stats.detectionRate * 100)}%)</span></div>
          </div>
          {speedHistory.current.length > 0 && (
            <SpeedGraph history={speedHistory.current} maxSpeed={Math.max(stats.speedBytesPerSec * 2, 1024)} />
          )}
          <p class="settings-hint">{t("cimbar.estimatedStats")}</p>
        </>
      )}
      {result && (
        <div class="result-section">
          <p>{t("cimbar.complete", { filename: result.filename })}</p>
          <TransferSummary
            bytes={stats.expectedSize || stats.receivedBytes}
            durationSec={stats.elapsedMs / 1000}
            speedBytesPerSec={stats.speedBytesPerSec}
            detail={`${stats.detectedFrames} / ${stats.scannedFrames} ${t("transfer.matrices")}${result.verified === true ? " · SHA-256 ✓" : result.verified === false ? " · SHA-256 ✗" : ""}`}
          />
          {result.verified === false && <p class="error-msg" role="alert">{t("receiver.hashWarning")}</p>}
          {result.text != null ? (
            <TextResultView text={result.text} filename={result.filename} />
          ) : (
            <div class="share-actions">
              <FilePreview url={result.url} filename={result.filename} />
              <a class="download-btn" href={result.url} download={result.filename}>{t("common.download")}</a>
              {shareService.isShareSupported() && (
                <button class="start-btn share-action" onClick={async () => {
                  const outcome = await shareService.shareFile(result.file);
                  setShareStatus(outcome.kind === "shared" || outcome.kind === "cancelled" || outcome.kind === "unsupported" ? outcome.kind : "shared");
                }}>
                  {t("common.share")}
                </button>
              )}
            </div>
          )}
          {shareStatus === "unsupported" && <p class="error-msg" role="alert">{t("cimbar.shareUnsupported")}</p>}
          {shareStatus === "cancelled" && <p class="settings-hint">{t("cimbar.shareCancelled")}</p>}
          {shareStatus === "shared" && <p class="settings-hint">{t("cimbar.shareSuccess")}</p>}
        </div>
      )}
    </section>
  );
}
