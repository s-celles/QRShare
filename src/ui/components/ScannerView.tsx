import { signal } from "@preact/signals";
import { useRef, useCallback, useEffect } from "preact/hooks";
import { navigate } from "../router";
import { ShareService } from "@/share/service";
import { pendingFile } from "../shared-file";

const shareService = new ShareService();

const isScanning = signal(false);
const scannedText = signal<string | null>(null);
const scanType = signal<string | null>(null);
const cameraError = signal<string | null>(null);
const devices = signal<MediaDeviceInfo[]>([]);
const selectedDeviceId = signal("");
const cameraResolution = signal<{ width: number; height: number } | null>(null);
const copyFeedback = signal(false);

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ScannerView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

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

  const updateCameraInfo = useCallback(async (stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    if (track) {
      const settings = track.getSettings();
      cameraResolution.value = {
        width: settings.width ?? 0,
        height: settings.height ?? 0,
      };
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      devices.value = allDevices.filter((d) => d.kind === "videoinput");
      if (!selectedDeviceId.value && track) {
        selectedDeviceId.value = track.getSettings().deviceId ?? "";
      }
    } catch {
      // Device enumeration not supported
    }
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        isScanning.value = true;
        cameraError.value = null;

        await new Promise((r) => requestAnimationFrame(r));

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        await updateCameraInfo(stream);

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
                scannedText.value = text;
                scanType.value = symbols[0].typeName ?? "QR-Code";
              }
            }
          } catch {
            /* ignore scan errors */
          }

          animFrameRef.current = requestAnimationFrame(tick);
        };

        animFrameRef.current = requestAnimationFrame(tick);
      } catch {
        cameraError.value =
          "Camera access denied. Please grant camera permissions in your browser settings.";
      }
    },
    [updateCameraInfo],
  );

  const handleDeviceChange = useCallback(
    async (e: Event) => {
      const newDeviceId = (e.target as HTMLSelectElement).value;
      selectedDeviceId.value = newDeviceId;
      // Stop current stream and restart with new device
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      await startCamera(newDeviceId);
    },
    [startCamera],
  );

  const handleCopy = useCallback(async () => {
    if (!scannedText.value) return;
    try {
      await navigator.clipboard.writeText(scannedText.value);
      copyFeedback.value = true;
      setTimeout(() => {
        copyFeedback.value = false;
      }, 2000);
    } catch {
      // Clipboard API not available
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!scannedText.value) return;
    try {
      await navigator.share({ title: "Scanned QR", text: scannedText.value });
    } catch {
      // Share cancelled or unsupported
    }
  }, []);

  const textToBuffer = useCallback(
    (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer,
    [],
  );

  const handleSendQR = useCallback(() => {
    if (!scannedText.value) return;
    pendingFile.value = {
      buffer: textToBuffer(scannedText.value),
      filename: "scanned-qr.txt",
    };
    navigate("/send/qr");
  }, [textToBuffer]);

  const handleSendWebRTC = useCallback(() => {
    if (!scannedText.value) return;
    pendingFile.value = {
      buffer: textToBuffer(scannedText.value),
      filename: "scanned-qr.txt",
    };
    navigate("/send/webrtc");
  }, [textToBuffer]);

  const cleanup = useCallback(() => {
    stopScanning();
    scannedText.value = null;
    scanType.value = null;
    cameraError.value = null;
    devices.value = [];
    selectedDeviceId.value = "";
    cameraResolution.value = null;
    copyFeedback.value = false;
  }, [stopScanning]);

  useEffect(() => cleanup, [cleanup]);

  return (
    <section aria-label="QR Scanner">
      <div class="view-header">
        <button
          onClick={() => {
            cleanup();
            navigate("/");
          }}
          aria-label="Back to home"
        >
          &larr; Back
        </button>
        <h2>Scan QR Code</h2>
      </div>

      {cameraError.value && (
        <div class="error-msg" role="alert">
          {cameraError.value}
        </div>
      )}

      {!isScanning.value && (
        <div class="scanner-setup">
          <p>Point your camera at a QR code to scan its content.</p>
          <button class="start-btn" onClick={() => startCamera()}>
            Start Scanning
          </button>
        </div>
      )}

      {isScanning.value && (
        <div class="scanner-active">
          <div class="viewfinder" aria-label="Camera viewfinder">
            <video
              ref={videoRef}
              class="camera-video"
              playsInline
              muted
              aria-label="Camera feed"
            />
            <div class="viewfinder-overlay">
              <div class="corner tl" />
              <div class="corner tr" />
              <div class="corner bl" />
              <div class="corner br" />
            </div>
          </div>
          <canvas ref={canvasRef} class="sr-only" aria-hidden="true" />

          <div class="scanner-info">
            {devices.value.length > 1 && (
              <div class="scanner-param">
                <label htmlFor="camera-select">Camera:</label>
                <select
                  id="camera-select"
                  value={selectedDeviceId.value}
                  onChange={handleDeviceChange}
                >
                  {devices.value.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {devices.value.length === 1 && (
              <div class="scanner-param">
                <span class="param-label">Camera:</span>
                <span class="param-value">
                  {devices.value[0].label || "Default"}
                </span>
              </div>
            )}
            {cameraResolution.value && (
              <div class="scanner-param">
                <span class="param-label">Resolution:</span>
                <span class="param-value">
                  {cameraResolution.value.width} &times;{" "}
                  {cameraResolution.value.height}
                </span>
              </div>
            )}
            {scanType.value && (
              <div class="scanner-param">
                <span class="param-label">Type:</span>
                <span class="param-value">{scanType.value}</span>
              </div>
            )}
          </div>

          {scannedText.value && (
            <div class="scanner-result" aria-live="polite">
              <h3>Scanned Content</h3>
              {isHttpUrl(scannedText.value) ? (
                <div class="result-content">
                  <a
                    href={scannedText.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="result-link"
                  >
                    {scannedText.value}
                  </a>
                </div>
              ) : (
                <div class="result-content">
                  <pre class="result-text">{scannedText.value}</pre>
                </div>
              )}
              <div class="share-actions">
                <button class="copy-btn" onClick={handleCopy}>
                  {copyFeedback.value ? "Copied!" : "Copy to Clipboard"}
                </button>
                {shareService.isShareSupported() && (
                  <button class="start-btn share-action" onClick={handleShare}>
                    Share
                  </button>
                )}
                <button class="start-btn share-action" onClick={handleSendQR}>
                  Send via QR
                </button>
                <button class="start-btn share-action" onClick={handleSendWebRTC}>
                  Send via WebRTC
                </button>
              </div>
            </div>
          )}

          <button class="stop-btn" onClick={stopScanning}>
            Stop
          </button>
        </div>
      )}
    </section>
  );
}
