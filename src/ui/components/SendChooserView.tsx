import { useMemo } from "preact/hooks";
import { hashParams, navigate } from "../router";
import { pendingText } from "../shared-file";
import {
  allowedSendModes,
  parseSendPolicy,
  payloadSize,
  recommendSendMode,
  type SendMode,
} from "../send-policy";
import { t } from "../i18n";

const MODE_ROUTES: Record<SendMode, "/create" | "/send/qr" | "/send/cimbar" | "/send/webrtc" | "/send/share"> = {
  "static-qr": "/create",
  "animated-qr": "/send/qr",
  cimbar: "/send/cimbar",
  webrtc: "/send/webrtc",
  share: "/send/share",
};

export function SendChooserView() {
  const params = hashParams.value;
  const data = params.get("data") ?? params.get("text") ?? "";
  const policy = parseSendPolicy(params.get("policy"));
  const size = payloadSize(data);
  const recommended = recommendSendMode(data, policy);
  const modes = useMemo(() => allowedSendModes(policy), [policy]);

  const choose = (mode: SendMode) => {
    if (!data) return;
    pendingText.value = data;
    navigate(MODE_ROUTES[mode]);
  };

  return (
    <section aria-label={t("sendChooser.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t("sendChooser.heading")}</h2>
      </div>

      {!data ? (
        <div class="error-msg" role="alert">{t("sendChooser.missingData")}</div>
      ) : (
        <div class="creator-content">
          <p>{t("sendChooser.summary", { size })}</p>
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
                onClick={() => choose(mode)}
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
