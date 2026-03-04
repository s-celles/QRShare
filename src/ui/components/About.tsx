import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { navigate } from "../router";
import { renderQRToDataURL } from "@/qr/renderer";
import { t } from "../i18n";
import { APP_VERSION, BUILD_HASH } from "../../version";

const siteQR = signal<string | null>(null);

export function About() {
  useEffect(() => {
    // Generate QR code pointing to the deployed site
    const siteUrl = window.location.origin + window.location.pathname;
    const urlBytes = new TextEncoder().encode(siteUrl);
    siteQR.value = renderQRToDataURL(urlBytes, "balanced");
  }, []);

  return (
    <section aria-label={t("about.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          &larr; {t("common.back")}
        </button>
        <h2>{t("about.heading")}</h2>
      </div>

      <div class="about-content">
        {siteQR.value && (
          <div class="qr-display">
            <img
              src={siteQR.value}
              alt={t("about.qrAlt")}
              class="qr-image"
            />
          </div>
        )}

        <p class="about-description">
          {t("about.scanText")}
        </p>

        <div class="about-info">
          <p><strong>QRShare</strong> v{APP_VERSION} ({BUILD_HASH})</p>
          <p>{t("about.description")}</p>
          <p>{t("about.license")}</p>
          <p>
            <a
              href="https://github.com/s-celles/QRShare"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("about.sourceCode")}
            </a>
          </p>
        </div>

        <div class="about-disclaimer">
          <p>
            <strong>{t("about.disclaimer")}</strong> {t("about.disclaimerText")}
          </p>
        </div>
      </div>
    </section>
  );
}
