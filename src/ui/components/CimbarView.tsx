import { useEffect, useRef, useState } from "preact/hooks";
import { navigate } from "../router";
import { pendingFile, pendingText, TEXT_FILENAME, TEXT_MIME_TYPE } from "../shared-file";
import { t } from "../i18n";

type CimbarMode = 68 | 67 | 66;

const workerUrl = (name: string) => new URL(`cimbar/${name}`, window.location.href).toString();

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
  const [fps, setFps] = useState(15);
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
      <div class="cimbar-canvas-wrap">
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
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ filename: string; url: string } | null>(null);

  useEffect(() => {
    const worker = new Worker(workerUrl("cimbar-receive-worker.js"));
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") setReady(true);
      else if (message.type === "frame-done") busyRef.current = false;
      else if (message.type === "frame" && message.detected) setDetected(true);
      else if (message.type === "progress") {
        setDetected(true);
        setProgress(Math.max(0, ...message.values.map(Number)) * 100);
      } else if (message.type === "complete") {
        const url = URL.createObjectURL(new Blob([message.file]));
        if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = url;
        setResult({ filename: message.filename, url });
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);
      animationRef.current = requestAnimationFrame(pump);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

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
      <div class={`cimbar-camera ${detected ? "detected" : ""}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} class="sr-only" />
      </div>
      {scanning && <div class="progress-container"><div class="progress-bar" style={{ width: `${progress}%` }} /></div>}
      {result && <div class="result-section"><p>{t("cimbar.complete", { filename: result.filename })}</p><a class="download-btn" href={result.url} download={result.filename}>{t("common.download")}</a></div>}
    </section>
  );
}
