import { signal } from "@preact/signals";
import { useEffect, useMemo } from "preact/hooks";
import { hashParams, navigate } from "../router";
import { pendingFile, pendingText } from "../shared-file";
import {
  allowedSendModes,
  parseSendPolicy,
  payloadSize,
  recommendSendMode,
  recommendSendModeForSize,
  type SendMode,
} from "../send-policy";
import { HANDOFF_MODES, receiveFromOpener, type WindowLike } from "@/share/handoff";
import { takeSharedFile } from "@/share/shared-target";
import { t } from "../i18n";

const MODE_ROUTES: Record<SendMode, "/create" | "/send/qr" | "/send/cimbar" | "/send/webrtc" | "/send/share"> = {
  "static-qr": "/create",
  "animated-qr": "/send/qr",
  cimbar: "/send/cimbar",
  webrtc: "/send/webrtc",
  share: "/send/share",
};

/** A file handed over by the share target or another application (REQ-HANDOFF-001/002). */
const incomingFile = signal<File | null>(null);
const incomingOrigin = signal<string | null>(null);
const waiting = signal<"idle" | "waiting" | "timeout">("idle");

const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function SendChooserView() {
  const params = hashParams.value;
  const data = params.get("data") ?? params.get("text") ?? "";
  const policy = parseSendPolicy(params.get("policy"));
  const handoff = params.get("handoff") === "1";
  // REQ-HANDOFF-006: an application may ask for a send mode (e.g. animated QR) and skip the choice.
  const askedMode = HANDOFF_MODES.find((m) => m === params.get("mode"));
  const shared = params.get("shared") === "1";
  const file = incomingFile.value;

  useEffect(() => {
    if (shared) {
      void takeSharedFile().then((f) => {
        if (f) incomingFile.value = f;
      });
    } else if (handoff && !incomingFile.value) {
      waiting.value = "waiting";
      void receiveFromOpener(window as unknown as WindowLike).then((result) => {
        if (!result) {
          waiting.value = "timeout";
          return;
        }
        waiting.value = "idle";
        incomingFile.value = result.file;
        incomingOrigin.value = result.origin;
      });
    }
  }, [shared, handoff]);

  const size = file ? file.size : payloadSize(data);
  const recommended = file ? recommendSendModeForSize(size, policy, false) : recommendSendMode(data, policy);
  // A single static QR code carries text only.
  const modes = useMemo(
    () => allowedSendModes(policy).filter((mode) => !file || mode !== "static-qr"),
    [policy, file],
  );

  const choose = async (mode: SendMode) => {
    if (file) {
      pendingFile.value = { buffer: await file.arrayBuffer(), filename: file.name, isText: file.type.startsWith("text/"), mimeType: file.type || undefined };
      incomingFile.value = null;
      incomingOrigin.value = null;
    } else if (data) {
      pendingText.value = data;
    } else {
      return;
    }
    navigate(MODE_ROUTES[mode]);
  };

  useEffect(() => {
    if (file && askedMode && modes.includes(askedMode)) void choose(askedMode);
  }, [file, askedMode]);

  const hasPayload = !!file || !!data;

  return (
    <section aria-label={t("sendChooser.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t("sendChooser.heading")}</h2>
      </div>

      {!hasPayload ? (
        waiting.value === "waiting" ? (
          <p role="status">{t("sendChooser.waitingForApp")}</p>
        ) : waiting.value === "timeout" ? (
          <div class="error-msg" role="alert">{t("sendChooser.handoffTimeout")}</div>
        ) : shared ? (
          <p role="status">{t("sendChooser.loadingShared")}</p>
        ) : (
          <div class="error-msg" role="alert">{t("sendChooser.missingData")}</div>
        )
      ) : (
        <div class="creator-content">
          {file ? (
            <p>{t("sendChooser.fileSummary", { name: file.name, size: formatSize(file.size) })}</p>
          ) : (
            <p>{t("sendChooser.summary", { size })}</p>
          )}
          {incomingOrigin.value && (
            <p class="settings-hint">{t("sendChooser.fromApp", { origin: incomingOrigin.value })}</p>
          )}
          <p class="settings-hint">
            {policy === "airgap"
              ? t("sendChooser.airgapGuaranteed")
              : policy === "prefer-airgap"
                ? t("sendChooser.airgapPreferred")
                : t("sendChooser.anyPolicy")}
          </p>
          <div class="mode-grid" role="group" aria-label={t("sendChooser.modes")}>
            {modes.map((mode) => (
              <button
                class="mode-btn"
                onClick={() => void choose(mode)}
                aria-label={t(`sendChooser.${mode}`)}
              >
                <span class="mode-label">{t(`sendChooser.${mode}`)}</span>
                <span class="mode-desc">
                  {mode === recommended
                    ? t("sendChooser.recommended")
                    : t(`sendChooser.${mode}Desc`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
