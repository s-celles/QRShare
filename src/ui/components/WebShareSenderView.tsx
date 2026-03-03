import { signal } from "@preact/signals";
import { useRef, useCallback, useEffect } from "preact/hooks";
import { navigate } from "../router";
import { ShareService } from "@/share/service";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

const shareService = new ShareService();

const selectedFileNames = signal<string[]>([]);
const error = signal<string | null>(null);
const isShared = signal(false);
const preloadedFile = signal<{ buffer: ArrayBuffer; filename: string } | null>(
  null,
);

export function WebShareSenderView() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pending = pendingFile.value;
    if (pending) {
      preloadedFile.value = pending;
      pendingFile.value = null;
    }
    return () => {
      preloadedFile.value = null;
    };
  }, []);

  const handleShare = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    error.value = null;
    selectedFileNames.value = files.map((f) => f.name);

    if (!shareService.isShareSupported()) {
      error.value = t("shareSender.unsupported");
      return;
    }

    try {
      // Try sharing multiple files at once
      const canShareMultiple =
        navigator.canShare?.({ files }) ?? false;
      if (canShareMultiple) {
        await navigator.share({ files });
        isShared.value = true;
        return;
      }

      // Fallback: share files one by one
      for (const file of files) {
        const result = await shareService.shareFile(file);
        if (result.kind === "unsupported") {
          error.value = t("shareSender.unsupported");
          return;
        }
      }
      isShared.value = true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — not an error
        return;
      }
      error.value = err instanceof Error ? err.message : String(err);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        handleShare(Array.from(target.files));
      }
    },
    [handleShare],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleShare(Array.from(e.dataTransfer.files));
      }
    },
    [handleShare],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleSharePreloaded = useCallback(async () => {
    const pre = preloadedFile.value;
    if (!pre) return;
    const file = new File([pre.buffer], pre.filename, {
      type: "application/octet-stream",
    });
    await handleShare([file]);
  }, [handleShare]);

  const cleanup = useCallback(() => {
    selectedFileNames.value = [];
    error.value = null;
    isShared.value = false;
    preloadedFile.value = null;
    navigate("/");
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return (
    <section aria-label={t("shareSender.section")}>
      <div class="view-header">
        <button onClick={cleanup} aria-label={t("common.backToHome")}>
          {"\u2190 " + t("common.back")}
        </button>
        <h2>{t("shareSender.heading")}</h2>
      </div>

      {error.value && (
        <div class="error-msg" role="alert">
          {error.value}
        </div>
      )}

      {!isShared.value && (
        <div class="sender-setup">
          <div
            class="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label={t("shareSender.selectFiles")}
            onKeyDown={(e) => {
              if (e.key === "Enter") fileInputRef.current?.click();
            }}
          >
            <p>{t("shareSender.dropZone")}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            class="sr-only"
            onChange={handleInputChange}
            aria-label={t("common.fileInput")}
          />

          {preloadedFile.value && (
            <button
              class="start-btn"
              onClick={handleSharePreloaded}
              style={{ marginTop: "1rem" }}
              aria-label={t("shareSender.shareFile", { filename: preloadedFile.value.filename })}
            >
              {t("shareSender.shareFile", { filename: preloadedFile.value.filename })}
            </button>
          )}
        </div>
      )}

      {isShared.value && (
        <div class="webrtc-complete">
          <h3>{t("shareSender.success")}</h3>
          {selectedFileNames.value.length > 0 && (
            <p>
              {selectedFileNames.value.length === 1
                ? selectedFileNames.value[0]
                : t("shareSender.filesShared", { count: selectedFileNames.value.length })}
            </p>
          )}
          <button onClick={cleanup} aria-label={t("shareSender.doneAria")}>
            {t("common.done")}
          </button>
        </div>
      )}
    </section>
  );
}
