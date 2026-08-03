import { useEffect, useRef, useState } from "preact/hooks";
import { navigate } from "../router";
import { t } from "../i18n";
import { parseFrame } from "@/protocol/frame";

type Detection = "static" | "qr-fountain" | "cimbar";

export function UniversalScannerView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const busyRef = useRef(false);
  const cimbarRef = useRef<Worker | null>(null);
  const [consented, setConsented] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");

  const stop = () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cimbarRef.current?.terminate();
    cimbarRef.current = null;
    setRunning(false);
  };

  const routeTo = (detection: Detection) => {
    stop();
    const route = detection === "static" ? "/scan" : detection === "qr-fountain" ? "/receive/qr" : "/receive/cimbar";
    window.location.hash = `${route}?autostart=1`;
  };

  const start = async () => {
    setConsented(true);
    setStatus(t("universal.starting"));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const cimbar = new Worker(new URL("cimbar/cimbar-receive-worker.js", window.location.href));
      cimbarRef.current = cimbar;
      cimbar.onmessage = (event) => {
        if ((event.data.type === "frame" && event.data.detected) || (event.data.type === "stats" && event.data.detectedFrames > 0)) {
          routeTo("cimbar");
        }
      };
      setRunning(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const video = videoRef.current;
      if (!video) throw new Error("Camera view unavailable");
      video.srcObject = stream;
      await video.play();
      const zbar = await import("@undecaf/zbar-wasm");
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      const tick = async () => {
        if (!videoRef.current || !context || !canvas || !streamRef.current) return;
        if (!busyRef.current && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          busyRef.current = true;
          try {
            const symbols = await zbar.scanImageData(imageData);
            if (symbols.length > 0) {
              const data = symbols[0].data;
              try {
                const parsed = parseFrame(new Uint8Array(data));
                if (parsed.kind === "data") routeTo("qr-fountain");
                else routeTo("static");
              } catch { routeTo("static"); }
            }
            cimbarRef.current?.postMessage({ type: "frame", pixels: imageData.data.buffer, width: imageData.width, height: imageData.height, mode: 68 }, [imageData.data.buffer]);
          } finally {
            busyRef.current = false;
          }
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (error) {
      stop();
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <section aria-label={t("universal.section")}>
      <div class="view-header"><button onClick={() => { stop(); navigate("/"); }}>← {t("common.back")}</button><h2>{t("universal.heading")}</h2></div>
      {!consented && <div class="receiver-setup"><p>{t("universal.consent")}</p><button class="start-btn" onClick={start}>{t("universal.start")}</button></div>}
      {running && <><p class="settings-hint">{t("universal.detecting")}</p><div class="viewfinder"><video ref={videoRef} playsInline muted /><canvas ref={canvasRef} class="sr-only" /></div></>}
      {status && <div class="error-msg" role="alert">{status}</div>}
    </section>
  );
}
