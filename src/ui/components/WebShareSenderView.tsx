import { signal } from "@preact/signals";
import { useRef, useCallback, useEffect } from "preact/hooks";
import { navigate } from "../router";
import { ShareService } from "@/share/service";
import { pendingFile, pendingText } from "../shared-file";
import { ContentTypeToggle } from "./ContentTypeToggle";
import { TextInputArea } from "./TextInputArea";
import { t } from "../i18n";

const shareService = new ShareService();

const contentType = signal<"file" | "text">("file");
const textInput = signal("");
const selectedFiles = signal<File[]>([]);
const error = signal<string | null>(null);
const isShared = signal(false);
const preloadedFile = signal<{ buffer: ArrayBuffer; filename: string } | null>(
  null,
);

export function WebShareSenderView() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pt = pendingText.value;
    if (pt) {
      pendingText.value = null;
      contentType.value = "text";
      textInput.value = pt;
    }
    const pending = pendingFile.value;
    if (pending) {
      preloadedFile.value = pending;
      pendingFile.value = null;
    }
    return () => {
      preloadedFile.value = null;
    };
  }, []);

  const storeFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    error.value = null;
    selectedFiles.value = files;
  }, []);

  const handleInputChange = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        storeFiles(Array.from(target.files));
      }
    },
    [storeFiles],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        storeFiles(Array.from(e.dataTransfer.files));
      }
    },
    [storeFiles],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  // Called directly from a button click (user gesture)
  const doShare = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    if (!shareService.isShareSupported()) {
      error.value = t("shareSender.unsupported");
      return;
    }

    try {
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
        return;
      }
      error.value = err instanceof Error ? err.message : String(err);
    }
  }, []);

  const handleShareText = useCallback(async () => {
    const text = textInput.value.trim();
    if (!text) return;

    if (shareService.isShareSupported()) {
      const result = await shareService.shareText(text);
      if (result.kind === "shared") {
        isShared.value = true;
        return;
      }
      if (result.kind === "cancelled") return;
    }

    // Fallback: copy to clipboard
    const clipResult = await shareService.copyToClipboard(text);
    if (clipResult.kind === "copied") {
      isShared.value = true;
    } else {
      error.value = t("text.clipboardFailed");
    }
  }, []);

  const handleShareSelected = useCallback(() => {
    doShare(selectedFiles.value);
  }, [doShare]);

  const handleSharePreloaded = useCallback(() => {
    const pre = preloadedFile.value;
    if (!pre) return;
    const file = new File([pre.buffer], pre.filename, {
      type: "application/octet-stream",
    });
    doShare([file]);
  }, [doShare]);

  const handleClearSelection = useCallback(() => {
    selectedFiles.value = [];
    error.value = null;
    // Reset file input so re-selecting the same file triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const cleanup = useCallback(() => {
    selectedFiles.value = [];
    error.value = null;
    isShared.value = false;
    preloadedFile.value = null;
    contentType.value = "file";
    textInput.value = "";
    navigate("/");
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const hasFiles = selectedFiles.value.length > 0;

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

      {!isShared.value && !hasFiles && (
        <div class="sender-setup">
          <ContentTypeToggle
            value={contentType.value}
            onChange={(type) => { contentType.value = type; }}
          />

          {contentType.value === "text" ? (
            <>
              <TextInputArea
                value={textInput.value}
                onChange={(text) => { textInput.value = text; }}
              />
              <button
                class="start-btn"
                onClick={handleShareText}
                disabled={textInput.value.trim().length === 0}
                style={{ marginTop: "0.5rem" }}
                aria-label={t("text.shareNow")}
              >
                {t("text.shareNow")}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {!isShared.value && hasFiles && (
        <div class="webrtc-confirm">
          <h3>{t("shareSender.readyToShare")}</h3>
          <ul class="file-list">
            {selectedFiles.value.map((f) => (
              <li key={f.name}>{f.name} ({(f.size / 1024).toFixed(1)} KB)</li>
            ))}
          </ul>
          <div class="share-actions">
            <button
              class="start-btn"
              onClick={handleShareSelected}
              aria-label={t("shareSender.shareNow")}
            >
              {t("shareSender.shareNow")}
            </button>
            <button
              class="start-btn share-action"
              onClick={handleClearSelection}
              aria-label={t("shareSender.changeFiles")}
            >
              {t("shareSender.changeFiles")}
            </button>
          </div>
        </div>
      )}

      {isShared.value && (
        <div class="webrtc-complete">
          <h3>{t("shareSender.success")}</h3>
          {selectedFiles.value.length > 0 && (
            <p>
              {selectedFiles.value.length === 1
                ? selectedFiles.value[0].name
                : t("shareSender.filesShared", { count: selectedFiles.value.length })}
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
