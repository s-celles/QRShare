import { signal } from "@preact/signals";
import { useRef, useEffect, useCallback } from "preact/hooks";
import { navigate } from "../router";
import { renderQRToDataURL, type EncodingPreset } from "@/qr/renderer";
import { bundleFiles, makeBundleName } from "@/zip/bundle";
import type { EncodeWorkerInput, EncodeWorkerOutput } from "@/workers/types";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const preset = signal<EncodingPreset>("balanced");
const fps = signal(2);
const blockSizeValue = signal(250);
const currentFrame = signal<string | null>(null);
const frameNumber = signal(0);
const totalBlocks = signal(0);
const fileSize = signal(0);
const sha256 = signal("");
const isEncoding = signal(false);
const error = signal<string | null>(null);
const startTime = signal(0);
const selectedFiles = signal<string[]>([]);

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
    selectedFiles.value = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startEncoding = useCallback(
    (buffer: ArrayBuffer, filename: string) => {
      error.value = null;
      isEncoding.value = true;
      startTime.value = Date.now();

      const workerUrl = new URL("encode-worker.js", location.href);
      const worker = new Worker(workerUrl, { type: "module" });
      workerRef.current = worker;

      worker.onerror = (e) => {
        error.value = `Worker error: ${e.message || "failed to load"}`;
        isEncoding.value = false;
      };

      worker.onmessage = (e: MessageEvent<EncodeWorkerOutput>) => {
        const msg = e.data;
        switch (msg.type) {
          case "metadata":
            console.log("[sender] Metadata received, blocks:", msg.totalBlocks, "size:", msg.fileSize);
            totalBlocks.value = msg.totalBlocks;
            fileSize.value = msg.fileSize;
            sha256.value = msg.sha256;
            break;
          case "frame": {
            const bytes = new Uint8Array(msg.frameBytes);
            currentFrame.value = renderQRToDataURL(bytes, preset.value);
            frameNumber.value = msg.frameNumber;
            if (msg.frameNumber % 30 === 0) {
              console.log("[sender] Frame", msg.frameNumber, "symbolId:", msg.symbolId, "size:", bytes.length);
            }
            break;
          }
          case "error":
            console.error("[sender] Worker error:", msg.message);
            error.value = msg.message;
            isEncoding.value = false;
            break;
        }
      };

      worker.postMessage({
        type: "start",
        file: buffer,
        filename,
        preset: preset.value,
        blockSize: blockSizeValue.value,
        fps: fps.value,
      } satisfies EncodeWorkerInput);
    },
    [],
  );

  // Auto-start encoding if a pending file was passed from CreatorView
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (pendingHandled.current) return;
    const pending = pendingFile.value;
    if (pending) {
      pendingHandled.current = true;
      pendingFile.value = null;
      selectedFiles.value = [pending.filename];
      startEncoding(pending.buffer, pending.filename);
    }
  });

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (files.length === 0) return;

      if (files.length === 1) {
        const file = files[0];
        if (file.size > MAX_FILE_SIZE) {
          error.value = t("sender.fileTooLarge", { size: (file.size / 1024 / 1024).toFixed(1) });
          return;
        }
        selectedFiles.value = [file.name];
        const buffer = await file.arrayBuffer();
        startEncoding(buffer, file.name);
        return;
      }

      // Multiple files: check total size, then bundle as zip
      let totalSize = 0;
      const names: string[] = [];
      for (let i = 0; i < files.length; i++) {
        totalSize += files[i].size;
        names.push(files[i].name);
      }

      if (totalSize > MAX_FILE_SIZE) {
        error.value = t("sender.totalTooLarge", { size: (totalSize / 1024 / 1024).toFixed(1) });
        return;
      }

      selectedFiles.value = names;

      const entries = await Promise.all(
        Array.from(files).map(async (f) => ({
          name: f.name,
          data: new Uint8Array(await f.arrayBuffer()),
        })),
      );

      const zipped = bundleFiles(entries);
      const bundleName = makeBundleName(files.length);
      startEncoding(zipped.buffer as ArrayBuffer, bundleName);
    },
    [startEncoding],
  );

  const handleInputChange = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) handleFiles(target.files);
    },
    [handleFiles],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
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
    <section aria-label={t("sender.section")}>
      <div class="view-header">
        <button onClick={() => { cleanup(); navigate("/"); }} aria-label={t("common.backToHome")}>
          {"\u2190 " + t("common.back")}
        </button>
        <h2>{t("sender.heading")}</h2>
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
            aria-label={t("sender.selectFile")}
            onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
          >
            <p>{t("sender.dropZone")}</p>
            <p class="drop-hint">{t("sender.maxSize")}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            class="sr-only"
            onChange={handleInputChange}
            aria-label={t("common.fileInput")}
          />

          <div class="preset-selector">
            <label htmlFor="preset">{t("sender.encodingPreset")}</label>
            <select
              id="preset"
              value={preset.value}
              onChange={(e) => {
                preset.value = (e.target as HTMLSelectElement).value as EncodingPreset;
              }}
            >
              <option value="high_speed">{t("sender.presetHighSpeed")}</option>
              <option value="balanced">{t("sender.presetBalanced")}</option>
              <option value="high_reliability">{t("sender.presetHighReliability")}</option>
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
          <div class="qr-display" aria-label={t("sender.qrAnimation")}>
            {currentFrame.value && (
              <img
                src={currentFrame.value}
                alt={t("sender.qrFrame", { n: frameNumber.value })}
                class="qr-image"
              />
            )}
          </div>

          {selectedFiles.value.length > 1 && (
            <p class="settings-hint">
              {t("sender.bundledFiles", { count: selectedFiles.value.length, names: selectedFiles.value.join(", ") })}
            </p>
          )}

          <div class="transfer-stats" aria-live="polite">
            <div class="stat">
              <span class="stat-label">{t("sender.frame")}</span>
              <span class="stat-value">{frameNumber.value}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("sender.blocks")}</span>
              <span class="stat-value">{totalBlocks.value}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("sender.size")}</span>
              <span class="stat-value">
                {(fileSize.value / 1024).toFixed(1)} KB
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">{t("sender.elapsed")}</span>
              <span class="stat-value">{elapsed}s</span>
            </div>
          </div>

          <div class="fps-control">
            <label htmlFor="fps-slider">
              {t("sender.frameRate", { fps: fps.value })}
            </label>
            <input
              id="fps-slider"
              type="range"
              min="1"
              max="30"
              value={fps.value}
              onInput={handleFpsChange}
              aria-label={t("sender.adjustFrameRate")}
            />
          </div>

          <div class="fps-control">
            <label htmlFor="blocksize-slider">
              {t("sender.blockSize", { size: blockSizeValue.value })}
            </label>
            <input
              id="blocksize-slider"
              type="range"
              min="50"
              max="1000"
              step="10"
              value={blockSizeValue.value}
              onInput={(e) => { blockSizeValue.value = Number((e.target as HTMLInputElement).value); }}
              aria-label={t("sender.adjustBlockSize")}
              disabled={isEncoding.value}
            />
          </div>

          <button class="stop-btn" onClick={cleanup} aria-label={t("sender.stopEncoding")}>
            {t("common.stop")}
          </button>
        </div>
      )}
    </section>
  );
}
