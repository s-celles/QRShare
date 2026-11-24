import { signal } from "@preact/signals";
import { useRef, useCallback, useEffect, useState } from "preact/hooks";
import { navigate, hashParams } from "../router";
import { ShareService } from "@/share/service";
import { scanQRImage, readClipboardImage } from "@/qr/scan-image";
import { parseStructuredQR } from "@/qr/structured";
import { renderQRCustomToDataURL } from "@/qr/renderer";
import { WifiResultCard } from "./WifiResultCard";
import { ContactResultCard } from "./ContactResultCard";
import { IdentityResultCard } from "./IdentityResultCard";
import { FidoResultCard } from "./FidoResultCard";
import { WifiPrintModal } from "./WifiPrintModal";
import { pendingFile, pendingText } from "../shared-file";
import { t } from "../i18n";

const shareService = new ShareService();

const isScanning = signal(false);
const scannedText = signal<string | null>(null);
const scanType = signal<string | null>(null);
const scanError = signal<string | null>(null);
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

function qrShareUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    const currentPath = window.location.pathname.replace(/\/$/, "");
    const scannedPath = url.pathname.replace(/\/$/, "");
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== window.location.origin || scannedPath !== currentPath) return null;
    return url.hash.startsWith("#/") ? url : null;
  } catch {
    return null;
  }
}

export function ScannerView() {
  const [showRaw, setShowRaw] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const [readingImage, setReadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attemptRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  const stopScanning = useCallback(() => {
    attemptRef.current++;
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

  const showResult = useCallback((text: string, type: string) => {
    scannedText.value = text;
    scanType.value = type;
    setShowRaw(false);
    setShowPrintModal(false);
  }, []);

  const readImage = useCallback(async (source: Blob | "clipboard") => {
    stopScanning();
    const attempt = attemptRef.current;
    scanError.value = null;
    setReadingImage(true);
    let errorKey = "scanner.clipboardDenied";
    try {
      const image = source === "clipboard" ? await readClipboardImage() : source;
      if (attempt !== attemptRef.current) return;
      if (!image) {
        scanError.value = t("scanner.noClipboardImage");
        return;
      }
      errorKey = "scanner.imageFailed";
      const text = await scanQRImage(image);
      if (attempt !== attemptRef.current) return;
      if (text) {
        showResult(text, "QR-Code");
      } else {
        scanError.value = t("scanner.noCode");
      }
    } catch {
      if (attempt === attemptRef.current) scanError.value = t(errorKey);
    } finally {
      if (attempt === attemptRef.current) setReadingImage(false);
    }
  }, [showResult, stopScanning]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (isScanning.value || scannedText.value || event.defaultPrevented) return;
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (!image) {
        scanError.value = t("scanner.noClipboardImage");
        return;
      }
      event.preventDefault();
      void readImage(image);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [readImage]);

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
      const attempt = ++attemptRef.current;
      setReadingImage(false);
      scanError.value = null;
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (attempt !== attemptRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        isScanning.value = true;

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
          if (attempt !== attemptRef.current) return;
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
            if (attempt !== attemptRef.current) return;
            if (symbols.length > 0) {
              const text = symbols[0].decode();
              if (text) {
                stopScanning();
                showResult(text, symbols[0].typeName ?? "QR-Code");
                return;
              }
            }
          } catch {
            /* ignore scan errors */
          }

          animFrameRef.current = requestAnimationFrame(tick);
        };

        animFrameRef.current = requestAnimationFrame(tick);
      } catch {
        if (attempt !== attemptRef.current) return;
        stopScanning();
        scanError.value = t("common.cameraAccessDenied");
      }
    },
    [showResult, stopScanning, updateCameraInfo],
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

  const openInQRShare = useCallback(() => {
    const url = scannedText.value && qrShareUrl(scannedText.value);
    if (url) window.location.hash = url.hash;
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

  const handleSendStaticQR = useCallback(() => {
    if (!scannedText.value) return;
    pendingText.value = scannedText.value;
    navigate("/create");
  }, []);

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
    scanError.value = null;
    devices.value = [];
    selectedDeviceId.value = "";
    cameraResolution.value = null;
    copyFeedback.value = false;
  }, [stopScanning]);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (hashParams.value.get("autostart") === "1") void startCamera();
  }, [startCamera]);

  return (
    <section aria-label={t("scanner.section")}>
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
        <h2>{t("scanner.heading")}</h2>
      </div>

      {scanError.value && (
        <div class="error-msg" role="alert">
          {scanError.value}
        </div>
      )}

      {!isScanning.value && !scannedText.value && (
        <div class="scanner-setup">
          <p>{t("scanner.setupText")}</p>
          <div class="share-actions">
            <button class="start-btn" disabled={readingImage} onClick={() => startCamera()}>
              {t("scanner.startScanning")}
            </button>
            <button disabled={readingImage} onClick={() => fileRef.current?.click()}>
              {t("scanner.chooseImage")}
            </button>
            {typeof navigator.clipboard?.read === "function" && (
              <button disabled={readingImage} onClick={() => readImage("clipboard")}>
                {t("scanner.pasteImage")}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (file) void readImage(file);
          }} />
          <p class="settings-hint">{t("scanner.pasteHint")}</p>
          {readingImage && <p role="status">{t("scanner.readingImage")}</p>}
        </div>
      )}

      {isScanning.value && (
        <div class="scanner-active">
          <div class="viewfinder" aria-label={t("common.cameraViewfinder")}>
            <video
              ref={videoRef}
              class="camera-video"
              playsInline
              muted
              aria-label={t("common.cameraFeed")}
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
                <label htmlFor="camera-select">{t("scanner.camera")}</label>
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
                <span class="param-label">{t("scanner.camera")}</span>
                <span class="param-value">
                  {devices.value[0].label || t("scanner.cameraDefault")}
                </span>
              </div>
            )}
            {cameraResolution.value && (
              <div class="scanner-param">
                <span class="param-label">{t("scanner.resolution")}</span>
                <span class="param-value">
                  {cameraResolution.value.width} &times;{" "}
                  {cameraResolution.value.height}
                </span>
              </div>
            )}
            {scanType.value && (
              <div class="scanner-param">
                <span class="param-label">{t("scanner.type")}</span>
                <span class="param-value">{scanType.value}</span>
              </div>
            )}
          </div>

          <button class="stop-btn" onClick={stopScanning}>
            {t("common.stop")}
          </button>
        </div>
      )}

      {scannedText.value && (() => {
        const structured = parseStructuredQR(scannedText.value);
        const wifiQrDataUrl = structured.kind === "wifi" ? (() => {
          try {
            return renderQRCustomToDataURL(new TextEncoder().encode(scannedText.value), {
              eccLevel: "M",
              autoVersion: true,
            });
          } catch {
            return null;
          }
        })() : null;

        return (
          <div class="scanner-result" aria-live="polite">
            <h3>{t("scanner.scannedContent")}</h3>

            {structured.kind === "wifi" && !showRaw && (
              <WifiResultCard
                wifi={structured}
                onPrint={() => setShowPrintModal(true)}
              />
            )}

            {structured.kind === "contact" && !showRaw && (
              <ContactResultCard contact={structured} />
            )}

            {structured.kind === "trusted-identity" && !showRaw && (
              <IdentityResultCard identity={structured} />
            )}

            {structured.kind === "fido" && !showRaw && (
              <FidoResultCard fido={structured} raw={structured.raw} />
            )}

            {(structured.kind === "text" || structured.kind === "url" || showRaw) && (
              isHttpUrl(scannedText.value) ? (
                <div class="result-content">
                  <a
                    href={scannedText.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="result-link"
                  >
                    {scannedText.value}
                  </a>
                  {qrShareUrl(scannedText.value) && (
                    <button class="start-btn share-action" onClick={openInQRShare}>
                      {t("scanner.openInQRShare")}
                    </button>
                  )}
                </div>
              ) : (
                <div class="result-content">
                  <pre class="result-text">{scannedText.value}</pre>
                </div>
              )
            )}

            {(structured.kind === "wifi" || structured.kind === "contact" || structured.kind === "trusted-identity" || structured.kind === "fido") && (
              <div class="card-toggle-row">
                <button class="icon-btn-text" onClick={() => setShowRaw(!showRaw)}>
                  {showRaw ? t("structured.toggleStructured") : t("structured.toggleRaw")}
                </button>
              </div>
            )}

            {/* REQ-STRUCT-009: a passkey code is not copied, shared or sent on. */}
            {structured.kind !== "fido" && (
              <div class="share-actions">
                <button class="copy-btn" onClick={handleCopy}>
                  {copyFeedback.value ? t("scanner.copied") : t("scanner.copyToClipboard")}
                </button>
                {shareService.isShareSupported() && (
                  <button class="start-btn share-action" onClick={handleShare}>
                    {t("common.share")}
                  </button>
                )}
                <button class="start-btn share-action" onClick={handleSendStaticQR}>
                  {t("scanner.sendStaticQR")}
                </button>
                <button class="start-btn share-action" onClick={handleSendQR}>
                  {t("scanner.sendAnimatedQR")}
                </button>
                <button class="start-btn share-action" onClick={handleSendWebRTC}>
                  {t("common.sendWebRTC")}
                </button>
              </div>
            )}

            <button onClick={cleanup}>{t("scanner.scanAgain")}</button>

            {showPrintModal && structured.kind === "wifi" && (
              <WifiPrintModal
                wifi={structured}
                qrDataUrl={wifiQrDataUrl}
                onClose={() => setShowPrintModal(false)}
              />
            )}
          </div>
        );
      })()}
    </section>
  );
}
