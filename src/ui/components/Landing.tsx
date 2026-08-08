import { navigate } from "../router";
import { NearbyDevices } from "./NearbyDevices";
import { TransferOfferModal } from "./TransferOfferModal";
import { t } from "../i18n";

export function Landing() {
  return (
    <section class="landing" aria-label={t("landing.home")}>
      <NearbyDevices />
      <TransferOfferModal />
      <h2>{t("landing.primaryActions")}</h2>
      <div class="mode-grid" role="group" aria-label={t("landing.qrUtilitiesGroup")}>
        <button class="mode-btn mode-btn--full" onClick={() => navigate("/scan/auto")} aria-label={t("landing.universalScanAria")}>
          <span class="mode-icon" aria-hidden="true">⌕</span>
          <span class="mode-label">{t("landing.universalScanTitle")}</span>
          <span class="mode-desc">{t("landing.universalScanDesc")}</span>
        </button>
        <button class="mode-btn mode-btn--full" onClick={() => navigate("/create/url")} aria-label={t("landing.createUrlAria")}>
          <span class="mode-icon" aria-hidden="true">🔗</span>
          <span class="mode-label">{t("landing.createUrlTitle")}</span>
          <span class="mode-desc">{t("landing.createUrlDesc")}</span>
        </button>
      </div>

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

      <h3 class="mode-group-title">{t("landing.shareGroup")}</h3>
      <div class="mode-grid" role="group" aria-label={t("landing.shareGroup")}>
        <button
          class="mode-btn mode-btn--full"
          onClick={() => navigate("/send/share")}
          aria-label={t("landing.sendShareAria")}
        >
          <span class="mode-icon" aria-hidden="true">
            &#x1F4E4;
          </span>
          <span class="mode-label">{t("landing.sendShareTitle")}</span>
          <span class="mode-desc">{t("landing.sendShareDesc")}</span>
        </button>
      </div>

      <h3 class="mode-group-title">{t("landing.qrGroup")}</h3>
      <div class="mode-grid" role="group" aria-label={t("landing.qrGroup")}>
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
      </div>

      <h3 class="mode-group-title">{t("landing.cimbarGroup")}</h3>
      <div class="mode-grid" role="group" aria-label={t("landing.cimbarGroup")}>
        <button class="mode-btn" onClick={() => navigate("/send/cimbar")} aria-label={t("landing.sendCimbarAria")}>
          <span class="mode-icon" aria-hidden="true">▦</span>
          <span class="mode-label">{t("landing.sendCimbarTitle")}</span>
          <span class="mode-desc">{t("landing.sendCimbarDesc")}</span>
        </button>
        <button class="mode-btn" onClick={() => navigate("/receive/cimbar")} aria-label={t("landing.receiveCimbarAria")}>
          <span class="mode-icon" aria-hidden="true">▧</span>
          <span class="mode-label">{t("landing.receiveCimbarTitle")}</span>
          <span class="mode-desc">{t("landing.receiveCimbarDesc")}</span>
        </button>
      </div>

      <h3 class="mode-group-title">{t("landing.webrtcGroup")}</h3>
      <div class="mode-grid" role="group" aria-label={t("landing.webrtcGroup")}>
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
      </div>
      <p class="settings-hint">{t("landing.collabNote")}</p>
    </section>
  );
}
