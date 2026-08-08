import type { StructuredQR } from "@/qr/structured";
import { buildVCardString } from "@/qr/structured";
import { t } from "../i18n";

interface ContactResultCardProps {
  contact: Extract<StructuredQR, { kind: "contact" }>;
}

export function ContactResultCard({ contact }: ContactResultCardProps) {
  const initials = contact.fullName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "👤";

  const handleDownloadVCard = () => {
    const vcardStr = buildVCardString({
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      email: contact.email,
      org: contact.org,
      url: contact.url,
      note: contact.note,
    });
    const blob = new Blob([vcardStr], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${contact.fullName.replace(/\s+/g, "_") || "contact"}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="structured-card contact-card">
      <div class="card-header">
        <span class="card-badge contact-badge">📇 {t("structured.templateContact")} ({contact.format.toUpperCase()})</span>
      </div>

      <div class="contact-profile">
        <div class="contact-avatar">{initials}</div>
        <div class="contact-details">
          <h4 class="contact-name">{contact.fullName}</h4>
          {contact.org && <div class="contact-org">🏢 {contact.org}</div>}
        </div>
      </div>

      <div class="contact-fields">
        {contact.phone && (
          <div class="contact-field">
            <span class="field-label">📞 {t("structured.phone")}:</span>
            <a class="field-value" href={`tel:${contact.phone}`}>{contact.phone}</a>
          </div>
        )}
        {contact.email && (
          <div class="contact-field">
            <span class="field-label">✉️ {t("structured.email")}:</span>
            <a class="field-value" href={`mailto:${contact.email}`}>{contact.email}</a>
          </div>
        )}
        {contact.url && (
          <div class="contact-field">
            <span class="field-label">🌐 {t("structured.url")}:</span>
            <a class="field-value" href={contact.url} target="_blank" rel="noopener noreferrer">{contact.url}</a>
          </div>
        )}
        {contact.note && (
          <div class="contact-field">
            <span class="field-label">📝 {t("structured.note")}:</span>
            <span class="field-value">{contact.note}</span>
          </div>
        )}
      </div>

      <div class="card-actions">
        <button class="start-btn copy-btn" onClick={handleDownloadVCard}>
          💾 {t("structured.saveContact")}
        </button>
        {contact.phone && (
          <a class="start-btn share-action" href={`tel:${contact.phone}`}>
            📞 {t("structured.call")}
          </a>
        )}
        {contact.email && (
          <a class="start-btn share-action" href={`mailto:${contact.email}`}>
            ✉️ {t("structured.sendEmail")}
          </a>
        )}
        {contact.url && (
          <a class="start-btn share-action" href={contact.url} target="_blank" rel="noopener noreferrer">
            🌐 {t("structured.openUrl")}
          </a>
        )}
      </div>
    </div>
  );
}
