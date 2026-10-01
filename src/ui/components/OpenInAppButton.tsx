import { useState } from "preact/hooks";
import { getReturnUrl, openAndSend } from "@/share/handoff";
import { t } from "../i18n";

/**
 * "Open in <app>" for a received file, shown when an application opened the
 * receive screen with a `return` URL (REQ-HANDOFF-004). The file is only
 * delivered after the user clicks, and only to the return URL's origin.
 */
export function OpenInAppButton({ url, filename, mimeType }: { url: string; filename: string; mimeType?: string }) {
  const target = getReturnUrl();
  const [status, setStatus] = useState<string | null>(null);
  if (!target) return null;
  const host = target.host;

  const open = async () => {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], filename, { type: mimeType || blob.type });
    setStatus(t("handoff.sending", { host }));
    const result = await openAndSend(target, file);
    setStatus(
      result === "sent"
        ? t("handoff.sent", { host })
        : result === "blocked"
          ? t("handoff.blocked")
          : t("handoff.noAnswer", { host }),
    );
  };

  return (
    <>
      <button class="start-btn" style={{ marginTop: "0.5rem" }} onClick={() => void open()}>
        {t("handoff.openIn", { host })}
      </button>
      {status && <p class="settings-hint" role="status">{status}</p>}
    </>
  );
}
