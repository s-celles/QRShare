import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { WebRTCService } from "@/webrtc/service";
import type { TransferProgress } from "@/webrtc/types";

const progress = signal<TransferProgress | null>(null);
const error = signal<string | null>(null);
const roomIdInput = signal("");
const isConnecting = signal(false);
const isConnected = signal(false);
const isSending = signal(false);
const isComplete = signal(false);
const isScanning = signal(false);

export function WebRTCSenderView() {
  const serviceRef = useRef<WebRTCService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    serviceRef.current = new WebRTCService();
    return () => {
      serviceRef.current?.disconnect();
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

  const handleFile = useCallback(async (file: File) => {
    const svc = serviceRef.current;
    if (!svc) return;

    isSending.value = true;
    try {
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
      if (target.files?.[0]) handleFile(target.files[0]);
    },
    [handleFile],
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
    <section aria-label="WebRTC Sender">
      <div class="view-header">
        <button onClick={cleanup} aria-label="Back to home">
          &larr; Back
        </button>
        <h2>Send via WebRTC</h2>
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
                <video ref={videoRef} class="camera-video" playsInline muted aria-label="Camera feed" />
              </div>
              <canvas ref={canvasRef} class="sr-only" aria-hidden="true" />
              <button onClick={stopScanning} class="stop-btn" aria-label="Stop scanning">Cancel</button>
            </>
          ) : (
            <>
              <p>Scan the receiver's QR code or enter their Room ID:</p>
              <button onClick={startScanning} class="start-btn" style={{ marginBottom: "1rem" }} aria-label="Scan QR code">
                Scan QR Code
              </button>
              <div class="peer-id-input">
                <input
                  type="text"
                  value={roomIdInput.value}
                  onInput={(e) => {
                    roomIdInput.value = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Room ID"
                  aria-label="Receiver Room ID"
                />
                <button onClick={handleConnect} class="start-btn" aria-label="Connect to receiver">
                  Connect
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isConnecting.value && !isConnected.value && (
        <div class="webrtc-connect">
          <p>Connecting to room <code>{roomIdInput.value}</code>...</p>
          <p class="settings-hint">Discovering peer via Nostr relays</p>
        </div>
      )}

      {isConnected.value && code && !isSending.value && !isComplete.value && (
        <div class="webrtc-confirm">
          <h3>Confirmation Code</h3>
          <p class="confirmation-code" aria-label="Confirmation code">
            {code}
          </p>
          <p>Verify this code matches on the receiver's screen.</p>
          <div class="file-select">
            <button
              class="start-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Select a file to send"
            >
              Select File to Send
            </button>
            <input
              ref={fileInputRef}
              type="file"
              class="sr-only"
              onChange={handleInputChange}
              aria-label="File input"
            />
          </div>
        </div>
      )}

      {isSending.value && progress.value && (
        <div class="webrtc-transfer">
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="File transfer progress"
          >
            <div class="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">Progress</span>
              <span class="stat-value">{pct}%</span>
            </div>
            <div class="stat">
              <span class="stat-label">Speed</span>
              <span class="stat-value">
                {(progress.value.speedBytesPerSec / 1024).toFixed(0)} KB/s
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">Elapsed</span>
              <span class="stat-value">
                {(progress.value.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      )}

      {isComplete.value && (
        <div class="webrtc-complete">
          <h3>Transfer Complete</h3>
          <button onClick={cleanup} aria-label="Done, return to home">Done</button>
        </div>
      )}
    </section>
  );
}
