import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { navigate } from "../router";
import { renderQRToDataURL } from "@/qr/renderer";
import { t, locale } from "../i18n";
import { APP_VERSION, BUILD_HASH, BUILD_DATE } from "../../version";
import { SOURCE_URL } from "../links";
import { docRoute } from "../docs";

/** About window, modelled on the one of Progressive Web Office. */

const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;
const CHANGELOG_URL = `${SOURCE_URL}/blob/main/CHANGELOG.md`;

/** Whether the app runs installed (standalone window) rather than in a browser tab. */
function installed(): boolean {
  try {
    return (
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

const offlineReady = (): boolean => !!navigator.serviceWorker?.controller;

const knownCommit = (): boolean => BUILD_HASH !== "dev" && BUILD_HASH !== "unknown";

const yesNo = (value: boolean): string => t(value ? "about.yes" : "about.no");

function buildDateText(): string {
  const date = new Date(BUILD_DATE);
  return BUILD_DATE && !Number.isNaN(date.getTime()) ? date.toLocaleString(locale.value) : "—";
}

/** Plain-text details to paste into a bug report. */
export function debugReport(appUrl: string): string {
  return [
    `QRShare ${APP_VERSION} (${BUILD_HASH}${BUILD_DATE ? `, ${BUILD_DATE.slice(0, 10)}` : ""})`,
    appUrl,
    navigator.userAgent,
    `${t("about.language")}: ${document.documentElement.lang || navigator.language}`,
    `${t("about.installed")}: ${yesNo(installed())} · ${t("about.offline")}: ${yesNo(offlineReady())}`,
  ].join("\n");
}

function ExternalLink({ href, children, class: cls }: { href: string; children: ComponentChildren; class?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" class={cls}>
      {children}
    </a>
  );
}

/** The QR code full screen, easy to scan from a distance (click, Escape or Close to leave). */
function QrFullScreen({ src, alt, text, onClose }: { src: string; alt: string; text: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class="qr-full"
      aria-label={t("qr.fullScreen")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target === ref.current || target.classList.contains("qr-full-image")) onClose();
      }}
    >
      <img class="qr-full-image" src={src} alt={alt} />
      <p class="qr-full-text">{text}</p>
      <button type="button" class="primary" onClick={onClose} autoFocus>
        {t("common.close")}
      </button>
    </dialog>
  );
}

export function About() {
  const appUrl = window.location.origin + window.location.pathname;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setQr(renderQRToDataURL(new TextEncoder().encode(appUrl), "balanced"));
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const close = () => navigate("/");

  const copyDetails = () => {
    void navigator.clipboard?.writeText(debugReport(appUrl)).then(
      () => setStatus(t("about.copied")),
      () => setStatus(""),
    );
  };

  const commit = knownCommit() ? (
    <ExternalLink href={`${SOURCE_URL}/commit/${BUILD_HASH}`} class="mono">{BUILD_HASH}</ExternalLink>
  ) : (
    <span class="mono">{BUILD_HASH}</span>
  );

  const facts: [string, ComponentChildren][] = [
    [t("about.version"), <ExternalLink href={CHANGELOG_URL}>{APP_VERSION}</ExternalLink>],
    [t("about.commit"), commit],
    [t("about.built"), buildDateText()],
    [t("about.license"), <ExternalLink href={LICENSE_URL}>BSD-3-Clause</ExternalLink>],
    [t("about.installed"), yesNo(installed())],
    [t("about.offline"), yesNo(offlineReady())],
  ];

  return (
    <dialog
      ref={dialogRef}
      class="dialog about-dialog"
      aria-labelledby="about-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="about-title">{t("about.section")}</h2>

      <div class="about">
        <div class="about-head">
          <img class="about-logo" src="assets/icon.svg" alt="" width={56} height={56} />
          <div>
            <p class="about-name">QRShare</p>
            <p class="hint">{t("about.description")}</p>
          </div>
        </div>

        <div class="about-body">
          <dl class="about-facts">
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          {qr && (
            <figure class="about-qr-figure">
              {/* A click enlarges it, to scan from a distance or with a poor camera. */}
              <button
                type="button"
                class="qr-zoom"
                aria-label={t("qr.enlarge")}
                title={t("qr.enlargeTitle")}
                onClick={() => setZoomed(true)}
              >
                <img class="about-qr" src={qr} alt={t("about.qrAlt")} width={160} height={160} />
              </button>
              <figcaption class="hint">
                {t("about.scanText")}
                <br />
                <span class="mono">{appUrl}</span>
              </figcaption>
            </figure>
          )}
        </div>

        <ul class="about-links">
          <li>
            <a href="#/guide">{t("app.guide")}</a>
          </li>
          <li>
            <a href="#/docs">{t("about.docs")}</a>
          </li>
          <li>
            <a href={docRoute("connectivity")}>{t("about.connectivity")}</a>
          </li>
          <li>
            <a href={docRoute("collaboration")}>{t("about.collab")}</a>
          </li>
          <li>
            <ExternalLink href={SOURCE_URL}>{t("about.sourceCode")}</ExternalLink>
          </li>
          <li>
            <ExternalLink href={CHANGELOG_URL}>{t("about.changelog")}</ExternalLink>
          </li>
          <li>
            <ExternalLink href={`${SOURCE_URL}/issues/new`}>{t("about.report")}</ExternalLink>
          </li>
        </ul>

        <p class="hint">{t("about.privacy")}</p>
        <p class="hint">{t("about.credits")}</p>
        <p class="hint">
          <strong>{t("about.disclaimer")}</strong> {t("about.disclaimerText")}
        </p>
      </div>

      <div class="dialog-actions">
        <span class="hint" role="status">{status}</span>
        <button type="button" onClick={copyDetails} title={t("about.copyDetailsTitle")}>
          {t("about.copyDetails")}
        </button>
        <button type="button" class="primary" onClick={close} autoFocus>
          {t("common.close")}
        </button>
      </div>
      {zoomed && qr && (
        <QrFullScreen src={qr} alt={t("about.qrAlt")} text={appUrl} onClose={() => setZoomed(false)} />
      )}
    </dialog>
  );
}
