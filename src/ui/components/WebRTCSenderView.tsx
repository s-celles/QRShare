import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { WebRTCService } from "@/webrtc/service";
import type { TransferProgress } from "@/webrtc/types";

const progress = signal<TransferProgress | null>(null);
const error = signal<string | null>(null);
const peerIdInput = signal("");
const isConnected = signal(false);
const isSending = signal(false);
const isComplete = signal(false);

export function WebRTCSenderView() {
  const serviceRef = useRef<WebRTCService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    serviceRef.current = new WebRTCService();
    return () => {
      serviceRef.current?.disconnect();
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (!peerIdInput.value.trim()) return;
    const svc = serviceRef.current;
    if (!svc) return;

    try {
      error.value = null;
      await svc.connectToReceiver(peerIdInput.value.trim());
      isConnected.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }, []);

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
    isConnected.value = false;
    isSending.value = false;
    isComplete.value = false;
    progress.value = null;
    error.value = null;
    peerIdInput.value = "";
    navigate("/");
  }, []);

  const svc = serviceRef.current;
  const code = svc?.getConfirmationCode() || "";
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

      {!isConnected.value && !isComplete.value && (
        <div class="webrtc-connect">
          <p>Enter the receiver's Peer ID (from their QR code or screen):</p>
          <div class="peer-id-input">
            <input
              type="text"
              value={peerIdInput.value}
              onInput={(e) => {
                peerIdInput.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="Peer ID"
              aria-label="Receiver Peer ID"
            />
            <button onClick={handleConnect} class="start-btn" aria-label="Connect to receiver">
              Connect
            </button>
          </div>
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
