import { useRef } from "preact/hooks";
import { navigate } from "../router";
import { pendingFile, pendingText, TEXT_FILENAME, TEXT_MIME_TYPE } from "../shared-file";
import { t } from "../i18n";

interface CimbarSenderWindow extends Window {
  Main?: { importFile(file: File): void };
}

export function CimbarView({ direction }: { direction: "send" | "receive" }) {
  const preparedFile = useRef<File | null>(null);
  if (direction === "send" && preparedFile.current === null) {
    const pending = pendingFile.value;
    const text = pendingText.value;
    if (pending) {
      preparedFile.current = new File([pending.buffer], pending.filename);
      pendingFile.value = null;
    } else if (text) {
      preparedFile.current = new File([text], TEXT_FILENAME, { type: TEXT_MIME_TYPE });
      pendingText.value = null;
    }
  }

  const loadPreparedFile = (event: Event) => {
    const file = preparedFile.current;
    if (!file) return;
    const frame = event.currentTarget as HTMLIFrameElement;
    const cimbarWindow = frame.contentWindow as CimbarSenderWindow | null;
    cimbarWindow?.Main?.importFile(file);
    preparedFile.current = null;
  };

  return (
    <section class="cimbar-view" aria-label={t(`cimbar.${direction}Section`)}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t(`cimbar.${direction}Heading`)}</h2>
      </div>
      <p class="settings-hint">{t("cimbar.experimentalHint")}</p>
      <iframe
        class="cimbar-frame"
        src={direction === "send" ? "cimbar/index.html?ww=1" : "cimbar/recv.html"}
        title={t(`cimbar.${direction}FrameTitle`)}
        allow={direction === "receive" ? "camera; fullscreen" : "fullscreen"}
        onLoad={direction === "send" ? loadPreparedFile : undefined}
      />
    </section>
  );
}
