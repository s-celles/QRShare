import { useEffect, useMemo, useState } from "preact/hooks";
import { navigate } from "../router";
import { pendingFile, pendingText } from "../shared-file";
import { ContentTypeToggle } from "./ContentTypeToggle";
import { TextInputArea } from "./TextInputArea";
import { bundleFiles, makeBundleName } from "@/zip/bundle";
import { renderQRCustomToDataURL } from "@/qr/renderer";
import {
  buildReceiverUrl,
  payloadSize,
  recommendSendModeForSize,
  type SendMode,
  type SendPolicy,
} from "../send-policy";
import { t } from "../i18n";

type InvitationMode = Exclude<SendMode, "share">;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_CIMBAR_SIZE = 33 * 1024 * 1024;

export function UrlCreatorView() {
  const [contentType, setContentType] = useState<"file" | "text">("file");
  const [data, setData] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [policy, setPolicy] = useState<SendPolicy>("prefer-airgap");
  const [mode, setMode] = useState<InvitationMode>("animated-qr");
  const [error, setError] = useState("");

  const size = contentType === "text"
    ? payloadSize(data)
    : files.reduce((total, file) => total + file.size, 0);
  const hasContent = contentType === "text" ? data.trim().length > 0 : files.length > 0;
  const recommended = recommendSendModeForSize(size, policy, contentType === "text");
  const cimbarModes: InvitationMode[] = size <= MAX_CIMBAR_SIZE ? ["cimbar"] : [];
  const allowedModes: InvitationMode[] = policy === "airgap"
    ? (contentType === "text"
      ? ["static-qr", "animated-qr", ...cimbarModes]
      : ["animated-qr", ...cimbarModes])
    : (contentType === "text"
      ? ["static-qr", "animated-qr", ...cimbarModes, "webrtc"]
      : ["animated-qr", ...cimbarModes, "webrtc"]);

  useEffect(() => {
    setMode(recommended === "share" ? "animated-qr" : recommended);
  }, [recommended, contentType, policy]);

  const receiverUrl = hasContent ? buildReceiverUrl(window.location.href, mode, policy) : "";
  const invitationQr = useMemo(() => {
    if (!receiverUrl) return "";
    try {
      return renderQRCustomToDataURL(new TextEncoder().encode(receiverUrl), {
        eccLevel: "M",
        autoVersion: true,
      });
    } catch {
      return "";
    }
  }, [receiverUrl]);

  const selectFiles = (selected: FileList | null) => {
    const next = selected ? Array.from(selected) : [];
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_FILE_SIZE) {
      setFiles([]);
      setError(t("urlCreator.filesTooLarge"));
      return;
    }
    setError("");
    setFiles(next);
  };

  const receiverReady = async () => {
    if (!hasContent) return;
    setError("");
    try {
      if (contentType === "text") {
        pendingText.value = data;
      } else if (files.length === 1) {
        pendingFile.value = {
          buffer: await files[0].arrayBuffer(),
          filename: files[0].name,
        };
      } else {
        const entries = await Promise.all(files.map(async (file) => ({
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })));
        const bundle = bundleFiles(entries);
        pendingFile.value = {
          buffer: bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer,
          filename: makeBundleName(files.length),
        };
      }
      navigate(
        mode === "static-qr"
          ? "/create"
          : mode === "animated-qr"
            ? "/send/qr"
            : mode === "cimbar" ? "/send/cimbar" : "/send/webrtc",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section aria-label={t("urlCreator.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t("urlCreator.prepareHeading")}</h2>
      </div>

      <div class="creator-content">
        <ContentTypeToggle value={contentType} onChange={(type) => {
          setContentType(type);
          setError("");
        }} />

        {contentType === "text" ? (
          <TextInputArea value={data} onChange={setData} />
        ) : (
          <div class="creator-input">
            <label htmlFor="invitation-files">{t("urlCreator.selectFiles")}</label>
            <input
              id="invitation-files"
              type="file"
              multiple
              onChange={(event) => selectFiles((event.target as HTMLInputElement).files)}
            />
            {files.length > 0 && <p class="settings-hint">{files.map((file) => file.name).join(", ")}</p>}
          </div>
        )}

        <div class="creator-params">
          <div class="creator-param">
            <label htmlFor="send-policy">{t("urlCreator.policy")}</label>
            <select id="send-policy" value={policy} onChange={(event) =>
              setPolicy((event.target as HTMLSelectElement).value as SendPolicy)}>
              <option value="airgap">{t("urlCreator.policyAirgap")}</option>
              <option value="prefer-airgap">{t("urlCreator.policyPreferAirgap")}</option>
              <option value="any">{t("urlCreator.policyAny")}</option>
            </select>
          </div>
          <div class="creator-param">
            <label htmlFor="send-mode">{t("urlCreator.mode")}</label>
            <select id="send-mode" value={mode} onChange={(event) =>
              setMode((event.target as HTMLSelectElement).value as InvitationMode)} disabled={!hasContent}>
              {allowedModes.map((candidate) => (
                <option value={candidate}>
                  {t(`sendChooser.${candidate}`)}{candidate === recommended ? ` — ${t("urlCreator.recommended")}` : ""}
                </option>
              ))}
            </select>
          </div>
          {hasContent && <div class="creator-capacity">{t("urlCreator.payloadSize", { size })}</div>}
        </div>

        {error && <div class="error-msg" role="alert">{error}</div>}

        {invitationQr && (
          <>
            <h3>{t("urlCreator.scanInvitation")}</h3>
            <p class="settings-hint">{t("urlCreator.scanInvitationHint")}</p>
            <div class="qr-display">
              <img src={invitationQr} alt={t("urlCreator.invitationQrAlt")} class="qr-image" />
            </div>
            <details>
              <summary>{t("urlCreator.showLink")}</summary>
              <p class="settings-hint url-break">{receiverUrl}</p>
            </details>
            <button class="start-btn" onClick={receiverReady}>
              {t("urlCreator.receiverReady")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
