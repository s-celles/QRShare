import { signal, computed } from "@preact/signals";
import { useCallback, useEffect, useState } from "preact/hooks";
import { navigate } from "../router";
import {
  renderQRCustomToDataURL,
  getByteCapacity,
  getByteCapacityTable,
  type CorrectionLabel,
} from "@/qr/renderer";
import {
  buildWifiString,
  buildMecardString,
  buildVCardString,
  parseStructuredQR,
} from "@/qr/structured";
import { ShareService } from "@/share/service";
import { pendingFile, pendingText } from "../shared-file";
import { WifiPrintModal } from "./WifiPrintModal";
import { t } from "../i18n";

const shareService = new ShareService();

type TemplateType = "raw" | "wifi" | "contact";
type ContactFormat = "mecard" | "vcard";

const inputText = signal("");
const eccLevel = signal<CorrectionLabel>("M");
const autoVersion = signal(true);
const manualVersion = signal(5);

const template = signal<TemplateType>("raw");

// Wi-Fi Form Signals
const wifiSsid = signal("");
const wifiSecurity = signal<"WPA" | "WEP" | "nopass">("WPA");
const wifiPassword = signal("");
const wifiHidden = signal(false);

// Contact Form Signals
const contactFormat = signal<ContactFormat>("mecard");
const firstName = signal("");
const lastName = signal("");
const phone = signal("");
const email = signal("");
const org = signal("");
const url = signal("");
const note = signal("");

const textBytes = computed(() => new TextEncoder().encode(inputText.value));
const byteLength = computed(() => textBytes.value.byteLength);

const effectiveMaxVersion = computed(() => {
  if (!autoVersion.value) return manualVersion.value;
  const table = getByteCapacityTable();
  const capacities = table[eccLevel.value];
  for (let v = 1; v <= 40; v++) {
    if (capacities[v] >= byteLength.value) return v;
  }
  return 40;
});

const maxCapacity = computed(() =>
  getByteCapacity(
    autoVersion.value ? effectiveMaxVersion.value : manualVersion.value,
    eccLevel.value,
  ),
);

const isOverCapacity = computed(() => {
  if (byteLength.value === 0) return false;
  return byteLength.value > maxCapacity.value;
});

const qrDataUrl = computed(() => {
  if (byteLength.value === 0 || isOverCapacity.value) return null;
  try {
    return renderQRCustomToDataURL(textBytes.value, {
      eccLevel: eccLevel.value,
      autoVersion: autoVersion.value,
      manualVersion: autoVersion.value ? undefined : manualVersion.value,
    });
  } catch {
    return null;
  }
});

export function CreatorView() {
  const [showPrintModal, setShowPrintModal] = useState(false);

  const updatePayloadFromTemplate = useCallback(() => {
    if (template.value === "wifi") {
      if (!wifiSsid.value) {
        inputText.value = "";
      } else {
        inputText.value = buildWifiString({
          ssid: wifiSsid.value,
          security: wifiSecurity.value,
          password: wifiPassword.value,
          hidden: wifiHidden.value,
        });
      }
    } else if (template.value === "contact") {
      const fn = contactFormat.value === "mecard" ? buildMecardString : buildVCardString;
      inputText.value = fn({
        firstName: firstName.value,
        lastName: lastName.value,
        phone: phone.value,
        email: email.value,
        org: org.value,
        url: url.value,
        note: note.value,
      });
    }
  }, []);

  useEffect(() => {
    const text = pendingText.value;
    if (text) {
      pendingText.value = null;
      inputText.value = text;
      // Auto-detect template mode if text matches Wi-Fi or Contact
      const structured = parseStructuredQR(text);
      if (structured.kind === "wifi") {
        template.value = "wifi";
        wifiSsid.value = structured.ssid;
        wifiSecurity.value = structured.security;
        wifiPassword.value = structured.password || "";
        wifiHidden.value = !!structured.hidden;
      } else if (structured.kind === "contact") {
        template.value = "contact";
        contactFormat.value = structured.format;
        firstName.value = structured.firstName || "";
        lastName.value = structured.lastName || "";
        phone.value = structured.phone || "";
        email.value = structured.email || "";
        org.value = structured.org || "";
        url.value = structured.url || "";
        note.value = structured.note || "";
      } else {
        template.value = "raw";
      }
    }
  }, []);

  const handleTemplateChange = (e: Event) => {
    const newTpl = (e.target as HTMLSelectElement).value as TemplateType;
    template.value = newTpl;
    if (newTpl === "raw") {
      inputText.value = "";
    } else {
      updatePayloadFromTemplate();
    }
  };

  const handleTextInput = useCallback((e: Event) => {
    inputText.value = (e.target as HTMLTextAreaElement).value;
  }, []);

  const handleEccChange = useCallback((e: Event) => {
    eccLevel.value = (e.target as HTMLSelectElement).value as CorrectionLabel;
  }, []);

  const handleVersionModeChange = useCallback((e: Event) => {
    autoVersion.value = (e.target as HTMLSelectElement).value === "auto";
  }, []);

  const handleManualVersionChange = useCallback((e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (val >= 1 && val <= 40) {
      manualVersion.value = val;
    }
  }, []);

  const handleDownload = useCallback(() => {
    const dataUrl = qrDataUrl.value;
    if (!dataUrl) return;

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "qrcode.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const dataUrlToBlob = useCallback(async (): Promise<Blob | null> => {
    const dataUrl = qrDataUrl.value;
    if (!dataUrl) return null;
    const res = await fetch(dataUrl);
    return res.blob();
  }, []);

  const handleShare = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const file = new File([blob], "qrcode.png", { type: "image/png" });
    await shareService.shareFile(file);
  }, [dataUrlToBlob]);

  const handleSendQR = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    pendingFile.value = { buffer, filename: "qrcode.png" };
    navigate("/send/qr");
  }, [dataUrlToBlob]);

  const handleSendWebRTC = useCallback(async () => {
    const blob = await dataUrlToBlob();
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    pendingFile.value = { buffer, filename: "qrcode.png" };
    navigate("/send/webrtc");
  }, [dataUrlToBlob]);

  const cleanup = useCallback(() => {
    inputText.value = "";
    eccLevel.value = "M";
    autoVersion.value = true;
    manualVersion.value = 5;
    template.value = "raw";
    wifiSsid.value = "";
    wifiSecurity.value = "WPA";
    wifiPassword.value = "";
    wifiHidden.value = false;
    contactFormat.value = "mecard";
    firstName.value = "";
    lastName.value = "";
    phone.value = "";
    email.value = "";
    org.value = "";
    url.value = "";
    note.value = "";
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const parsedStructured = parseStructuredQR(inputText.value);

  return (
    <section aria-label={t("creator.section")}>
      <div class="view-header">
        <button
          onClick={() => {
            cleanup();
            navigate("/");
          }}
          aria-label={t("common.backToHome")}
        >
          ← {t("common.back")}
        </button>
        <h2>{t("creator.heading")}</h2>
      </div>

      <div class="creator-content">
        <div class="creator-param template-selector">
          <label htmlFor="template-mode">{t("structured.templateLabel")}</label>
          <select
            id="template-mode"
            value={template.value}
            onChange={handleTemplateChange}
          >
            <option value="raw">{t("structured.templateText")}</option>
            <option value="wifi">📶 {t("structured.templateWifi")}</option>
            <option value="contact">📇 {t("structured.templateContact")}</option>
          </select>
        </div>

        {template.value === "raw" && (
          <div class="creator-input">
            <label htmlFor="qr-text">{t("creator.contentLabel")}</label>
            <textarea
              id="qr-text"
              class="creator-textarea"
              value={inputText.value}
              onInput={handleTextInput}
              placeholder={t("creator.placeholder")}
              rows={4}
            />
          </div>
        )}

        {template.value === "wifi" && (
          <div class="structured-form wifi-form">
            <div class="creator-param">
              <label htmlFor="wifi-ssid">{t("structured.wifiSsid")} *</label>
              <input
                id="wifi-ssid"
                type="text"
                class="creator-input-field"
                value={wifiSsid.value}
                onInput={(e) => {
                  wifiSsid.value = (e.target as HTMLInputElement).value;
                  updatePayloadFromTemplate();
                }}
                placeholder="MyHomeWifi"
              />
            </div>
            <div class="creator-param">
              <label htmlFor="wifi-sec">{t("structured.wifiSecurity")}</label>
              <select
                id="wifi-sec"
                value={wifiSecurity.value}
                onChange={(e) => {
                  wifiSecurity.value = (e.target as HTMLSelectElement).value as any;
                  updatePayloadFromTemplate();
                }}
              >
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">None (Open)</option>
              </select>
            </div>
            {wifiSecurity.value !== "nopass" && (
              <div class="creator-param">
                <label htmlFor="wifi-pass">{t("structured.wifiPassword")}</label>
                <input
                  id="wifi-pass"
                  type="text"
                  class="creator-input-field"
                  value={wifiPassword.value}
                  onInput={(e) => {
                    wifiPassword.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                  placeholder="Password123"
                />
              </div>
            )}
            <div class="creator-param checkbox-param">
              <label htmlFor="wifi-hidden">
                <input
                  id="wifi-hidden"
                  type="checkbox"
                  checked={wifiHidden.value}
                  onChange={(e) => {
                    wifiHidden.value = (e.target as HTMLInputElement).checked;
                    updatePayloadFromTemplate();
                  }}
                />{" "}
                {t("structured.wifiHidden")}
              </label>
            </div>
          </div>
        )}

        {template.value === "contact" && (
          <div class="structured-form contact-form">
            <div class="creator-param">
              <label htmlFor="contact-fmt">{t("structured.contactFormat")}</label>
              <select
                id="contact-fmt"
                value={contactFormat.value}
                onChange={(e) => {
                  contactFormat.value = (e.target as HTMLSelectElement).value as any;
                  updatePayloadFromTemplate();
                }}
              >
                <option value="mecard">{t("structured.contactMecard")}</option>
                <option value="vcard">{t("structured.contactVcard")}</option>
              </select>
            </div>
            <div class="form-row-2">
              <div class="creator-param">
                <label htmlFor="first-name">{t("structured.firstName")}</label>
                <input
                  id="first-name"
                  type="text"
                  class="creator-input-field"
                  value={firstName.value}
                  onInput={(e) => {
                    firstName.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                />
              </div>
              <div class="creator-param">
                <label htmlFor="last-name">{t("structured.lastName")}</label>
                <input
                  id="last-name"
                  type="text"
                  class="creator-input-field"
                  value={lastName.value}
                  onInput={(e) => {
                    lastName.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                />
              </div>
            </div>
            <div class="form-row-2">
              <div class="creator-param">
                <label htmlFor="phone">{t("structured.phone")}</label>
                <input
                  id="phone"
                  type="tel"
                  class="creator-input-field"
                  value={phone.value}
                  onInput={(e) => {
                    phone.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                  placeholder="+33601020304"
                />
              </div>
              <div class="creator-param">
                <label htmlFor="email">{t("structured.email")}</label>
                <input
                  id="email"
                  type="email"
                  class="creator-input-field"
                  value={email.value}
                  onInput={(e) => {
                    email.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                  placeholder="user@example.com"
                />
              </div>
            </div>
            <div class="form-row-2">
              <div class="creator-param">
                <label htmlFor="org">{t("structured.org")}</label>
                <input
                  id="org"
                  type="text"
                  class="creator-input-field"
                  value={org.value}
                  onInput={(e) => {
                    org.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                />
              </div>
              <div class="creator-param">
                <label htmlFor="url">{t("structured.url")}</label>
                <input
                  id="url"
                  type="url"
                  class="creator-input-field"
                  value={url.value}
                  onInput={(e) => {
                    url.value = (e.target as HTMLInputElement).value;
                    updatePayloadFromTemplate();
                  }}
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div class="creator-param">
              <label htmlFor="note">{t("structured.note")}</label>
              <input
                id="note"
                type="text"
                class="creator-input-field"
                value={note.value}
                onInput={(e) => {
                  note.value = (e.target as HTMLInputElement).value;
                  updatePayloadFromTemplate();
                }}
              />
            </div>
          </div>
        )}

        <div class="creator-params">
          <div class="creator-param">
            <label htmlFor="ecc-level">{t("creator.errorCorrection")}</label>
            <select
              id="ecc-level"
              value={eccLevel.value}
              onChange={handleEccChange}
            >
              <option value="L">{t("creator.eccL")}</option>
              <option value="M">{t("creator.eccM")}</option>
              <option value="Q">{t("creator.eccQ")}</option>
              <option value="H">{t("creator.eccH")}</option>
            </select>
          </div>

          <div class="creator-param">
            <label htmlFor="version-mode">{t("creator.version")}</label>
            <select
              id="version-mode"
              value={autoVersion.value ? "auto" : "manual"}
              onChange={handleVersionModeChange}
            >
              <option value="auto">{t("creator.versionAuto")}</option>
              <option value="manual">{t("creator.versionManual")}</option>
            </select>
          </div>

          {!autoVersion.value && (
            <div class="creator-param">
              <label htmlFor="manual-version">
                {t("creator.versionRange")}
              </label>
              <input
                id="manual-version"
                type="number"
                min={1}
                max={40}
                value={manualVersion.value}
                onInput={handleManualVersionChange}
              />
            </div>
          )}

          <div class="creator-capacity">
            <span class="param-label">{t("creator.payload")}</span>
            <span
              class={`param-value ${isOverCapacity.value ? "over-capacity" : ""}`}
            >
              {byteLength.value} / {maxCapacity.value} {t("creator.bytes")}
              {autoVersion.value && byteLength.value > 0 && (
                <> (v{effectiveMaxVersion.value})</>
              )}
              {!autoVersion.value && <> (v{manualVersion.value})</>}
            </span>
          </div>
        </div>

        {isOverCapacity.value && (
          <div class="error-msg" role="alert">
            {t("creator.overCapacity")}
          </div>
        )}

        {byteLength.value === 0 && (
          <div class="creator-placeholder">
            <p>{t("creator.emptyState")}</p>
          </div>
        )}

        {qrDataUrl.value && (
          <div class="qr-display">
            <img
              src={qrDataUrl.value}
              alt={t("creator.qrAlt")}
              class="qr-image"
            />
          </div>
        )}

        {qrDataUrl.value && (
          <div class="share-actions">
            <button class="start-btn download-action" onClick={handleDownload}>
              {t("creator.downloadPNG")}
            </button>
            {parsedStructured.kind === "wifi" && (
              <button
                class="start-btn share-action"
                onClick={() => setShowPrintModal(true)}
              >
                🖨️ {t("structured.wifiPrintSign")}
              </button>
            )}
            {shareService.isShareSupported() && (
              <button class="start-btn share-action" onClick={handleShare}>
                {t("common.share")}
              </button>
            )}
            <button class="start-btn share-action" onClick={handleSendQR}>
              {t("common.sendQR")}
            </button>
            <button class="start-btn share-action" onClick={handleSendWebRTC}>
              {t("common.sendWebRTC")}
            </button>
          </div>
        )}

        {showPrintModal && parsedStructured.kind === "wifi" && (
          <WifiPrintModal
            wifi={parsedStructured}
            qrDataUrl={qrDataUrl.value}
            onClose={() => setShowPrintModal(false)}
          />
        )}
      </div>
    </section>
  );
}
