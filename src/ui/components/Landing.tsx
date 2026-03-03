import { navigate } from "../router";
import { t } from "../i18n";

export function Landing() {
  return (
    <section class="landing" aria-label={t("landing.home")}>
      <h2>{t("landing.qrUtilities")}</h2>
      <div class="mode-grid" role="group" aria-label={t("landing.qrUtilitiesGroup")}>
        <button
          class="mode-btn"
          onClick={() => navigate("/scan")}
          aria-label={t("landing.scanAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x1F4F7;
          </span>
          <span class="mode-label">{t("landing.scanTitle")}</span>
          <span class="mode-desc">{t("landing.scanDesc")}</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/create")}
          aria-label={t("landing.createAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x2B1A;
          </span>
          <span class="mode-label">{t("landing.createTitle")}</span>
          <span class="mode-desc">{t("landing.createDesc")}</span>
        </button>
      </div>

      <div class="section-divider" />

      <h2>{t("landing.fileTransfer")}</h2>
      <div class="mode-grid" role="group" aria-label={t("landing.transferGroup")}>
        <button
          class="mode-btn"
          onClick={() => navigate("/send/qr")}
          aria-label={t("landing.sendQRAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x25A3;
          </span>
          <span class="mode-label">{t("landing.sendQRTitle")}</span>
          <span class="mode-desc">{t("landing.sendQRDesc")}</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/receive/qr")}
          aria-label={t("landing.receiveQRAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x25A2;
          </span>
          <span class="mode-label">{t("landing.receiveQRTitle")}</span>
          <span class="mode-desc">{t("landing.receiveQRDesc")}</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/send/webrtc")}
          aria-label={t("landing.sendWebRTCAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x21C6;
          </span>
          <span class="mode-label">{t("landing.sendWebRTCTitle")}</span>
          <span class="mode-desc">{t("landing.sendWebRTCDesc")}</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/receive/webrtc")}
          aria-label={t("landing.receiveWebRTCAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x21C4;
          </span>
          <span class="mode-label">{t("landing.receiveWebRTCTitle")}</span>
          <span class="mode-desc">{t("landing.receiveWebRTCDesc")}</span>
        </button>
      </div>
    </section>
  );
}
