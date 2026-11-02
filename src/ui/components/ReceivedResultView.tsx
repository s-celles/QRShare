import { useEffect, useMemo, useState } from "preact/hooks";
import { ShareService } from "@/share/service";
import { isEncryptedPayload, decryptPayload, decryptPayloadECDH } from "@/crypto/encryption";
import { getLocalIdentity } from "@/crypto/identity";
import { getContacts } from "@/crypto/contacts";
import { TEXT_FILENAME, TEXT_MIME_TYPE } from "../shared-file";
import { t } from "../i18n";
import { TextResultView } from "./TextResultView";
import { TransferSummary } from "./TransferSummary";
import { FilePreview } from "./FilePreview";
import { OpenInAppButton } from "./OpenInAppButton";
import { EncryptedUnlockCard } from "./EncryptedUnlockCard";

const shareService = new ShareService();

export interface ReceivedPayload {
  readonly file: Uint8Array;
  readonly filename: string;
  /** Text flag from the transfer metadata; `null` infers it from the filename. */
  readonly isText: boolean | null;
  /** SHA-256 verification result; `null` when the transport cannot tell. */
  readonly verified: boolean | null;
}

export interface ReceivedSummary {
  readonly bytes: number;
  readonly durationSec: number;
  readonly speedBytesPerSec: number;
  readonly detail: string;
}

/**
 * Received-content view shared by the CIMBAR and audio receivers (REQ-AUD-040):
 * transfer summary, hash warning, password / contact unlock for encrypted
 * payloads, text view, or file preview with Download, Share and Open-in-app.
 */
export function ReceivedResultView({
  payload,
  summary,
  message,
}: {
  payload: ReceivedPayload;
  summary: ReceivedSummary;
  message?: string;
}) {
  const [content, setContent] = useState<Uint8Array>(payload.file);
  const [locked, setLocked] = useState(() => isEncryptedPayload(payload.file) && payload.file[4] !== 2);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState<"" | "shared" | "cancelled" | "unsupported">("");
  const isText = payload.isText ?? payload.filename === TEXT_FILENAME;

  useEffect(() => {
    setContent(payload.file);
    setLocked(isEncryptedPayload(payload.file) && payload.file[4] !== 2);
    setError("");
    // Contact (ECDH) encrypted payloads unlock with the local identity.
    if (isEncryptedPayload(payload.file) && payload.file[4] === 2) {
      void (async () => {
        try {
          const me = await getLocalIdentity();
          if (!me.ecdhPrivateKeyJwk) throw new Error("Local ECDH key missing");
          const plain = await decryptPayloadECDH(payload.file, me.ecdhPrivateKeyJwk, async (fingerprint) =>
            getContacts().find((c) => c.fingerprint === fingerprint)?.ecdhPublicKeyJwk || null);
          setContent(plain);
        } catch (err) {
          setError("E2EE Decryption Failed: " + (err instanceof Error ? err.message : String(err)));
        }
      })();
    }
  }, [payload.file]);

  const file = useMemo(
    () => new File([content as Uint8Array<ArrayBuffer>], payload.filename, {
      type: isText ? TEXT_MIME_TYPE : "application/octet-stream",
    }),
    [content, payload.filename, isText],
  );
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const text = useMemo(() => {
    if (!isText || locked) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return null;
    }
  }, [content, isText, locked]);

  const unlock = async (password: string) => {
    const plain = await decryptPayload(payload.file, password);
    setContent(plain);
    setLocked(false);
  };

  return (
    <div class="result-section">
      {message && <p>{message}</p>}
      <TransferSummary
        bytes={summary.bytes}
        durationSec={summary.durationSec}
        speedBytesPerSec={summary.speedBytesPerSec}
        detail={`${summary.detail}${payload.verified === true ? " · SHA-256 ✓" : payload.verified === false ? " · SHA-256 ✗" : ""}`}
      />
      {payload.verified === false && <p class="error-msg" role="alert">{t("receiver.hashWarning")}</p>}
      {error && <p class="error-msg" role="alert">{error}</p>}
      {locked ? (
        <EncryptedUnlockCard onUnlock={unlock} />
      ) : text != null ? (
        <TextResultView text={text} filename={payload.filename} />
      ) : (
        <div class="share-actions">
          <FilePreview url={url} filename={payload.filename} />
          <a class="download-btn" href={url} download={payload.filename}>{t("common.download")}</a>
          <OpenInAppButton url={url} filename={payload.filename} mimeType={file.type} />
          {shareService.isShareSupported() && (
            <button class="start-btn share-action" onClick={async () => {
              const outcome = await shareService.shareFile(file);
              setShareStatus(outcome.kind === "shared" || outcome.kind === "cancelled" || outcome.kind === "unsupported" ? outcome.kind : "shared");
            }}>
              {t("common.share")}
            </button>
          )}
        </div>
      )}
      {shareStatus === "unsupported" && <p class="error-msg" role="alert">{t("cimbar.shareUnsupported")}</p>}
      {shareStatus === "cancelled" && <p class="settings-hint">{t("cimbar.shareCancelled")}</p>}
      {shareStatus === "shared" && <p class="settings-hint">{t("cimbar.shareSuccess")}</p>}
    </div>
  );
}
