import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import type { EncodingPreset } from "@/qr/renderer";
import type { EncodeWorkerInput, EncodeWorkerOutput } from "@/workers/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const preset = signal<EncodingPreset>("balanced");
const fps = signal(12);
const currentFrame = signal<string | null>(null);
const frameNumber = signal(0);
const totalBlocks = signal(0);
const fileSize = signal(0);
const sha256 = signal("");
const isEncoding = signal(false);
const error = signal<string | null>(null);
const startTime = signal(0);

export function SenderView() {
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanup = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "stop" } satisfies EncodeWorkerInput);
      workerRef.current.terminate();
      workerRef.current = null;
    }
    isEncoding.value = false;
    currentFrame.value = null;
    frameNumber.value = 0;
    error.value = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleFile = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        error.value = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`;
        return;
      }
      error.value = null;
      isEncoding.value = true;
      startTime.value = Date.now();

      file.arrayBuffer().then((buffer) => {
        const worker = new Worker(
          new URL("../../workers/encode-worker.ts", import.meta.url),
          { type: "module" },
        );
        workerRef.current = worker;

        worker.onmessage = (e: MessageEvent<EncodeWorkerOutput>) => {
          const msg = e.data;
          switch (msg.type) {
            case "metadata":
              totalBlocks.value = msg.totalBlocks;
              fileSize.value = msg.fileSize;
              sha256.value = msg.sha256;
              break;
            case "frame":
              currentFrame.value = msg.dataUrl;
              frameNumber.value = msg.frameNumber;
              break;
            case "error":
              error.value = msg.message;
              isEncoding.value = false;
              break;
          }
        };

        worker.postMessage({
          type: "start",
          file: buffer,
          filename: file.name,
          preset: preset.value,
        } satisfies EncodeWorkerInput);
      });
    },
    [],
  );

  const handleInputChange = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files?.[0]) handleFile(target.files[0]);
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleFpsChange = useCallback((e: Event) => {
    const value = Number((e.target as HTMLInputElement).value);
    fps.value = value;
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: "set_fps",
        fps: value,
      } satisfies EncodeWorkerInput);
    }
  }, []);

  const elapsed = isEncoding.value
    ? ((Date.now() - startTime.value) / 1000).toFixed(0)
    : "0";

  return (
    <section aria-label="QR Sender">
      <div class="view-header">
        <button onClick={() => { cleanup(); navigate("/"); }} aria-label="Back to home">
          &larr; Back
        </button>
        <h2>Send via QR</h2>
      </div>

      {!isEncoding.value && (
        <div class="sender-setup">
          <div
            class="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Select file to send"
            onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
          >
            <p>Drop a file here or click to browse</p>
            <p class="drop-hint">Maximum 50 MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            class="sr-only"
            onChange={handleInputChange}
            aria-label="File input"
          />

          <div class="preset-selector">
            <label htmlFor="preset">Encoding Preset:</label>
            <select
              id="preset"
              value={preset.value}
              onChange={(e) => {
                preset.value = (e.target as HTMLSelectElement).value as EncodingPreset;
              }}
            >
              <option value="high_speed">High Speed (v25, ECC L, 15fps)</option>
              <option value="balanced">Balanced (v20, ECC M, 12fps)</option>
              <option value="high_reliability">High Reliability (v15, ECC Q, 8fps)</option>
            </select>
          </div>
        </div>
      )}

      {error.value && (
        <div class="error-msg" role="alert">
          {error.value}
        </div>
      )}

      {isEncoding.value && (
        <div class="sender-active">
          <div class="qr-display" aria-label="QR code animation">
            {currentFrame.value && (
              <img
                src={currentFrame.value}
                alt={`QR frame ${frameNumber.value}`}
                class="qr-image"
              />
            )}
          </div>

          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">Frame</span>
              <span class="stat-value">{frameNumber.value}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Blocks</span>
              <span class="stat-value">{totalBlocks.value}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Size</span>
              <span class="stat-value">
                {(fileSize.value / 1024).toFixed(1)} KB
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">Elapsed</span>
              <span class="stat-value">{elapsed}s</span>
            </div>
          </div>

          <div class="fps-control">
            <label htmlFor="fps-slider">
              Frame Rate: {fps.value} FPS
            </label>
            <input
              id="fps-slider"
              type="range"
              min="2"
              max="30"
              value={fps.value}
              onInput={handleFpsChange}
              aria-label="Adjust frame rate"
            />
          </div>

          <button class="stop-btn" onClick={cleanup} aria-label="Stop encoding">
            Stop
          </button>
        </div>
      )}
    </section>
  );
}
