import { useState } from "preact/hooks";
import { addContact } from "@/crypto/contacts";
import { t } from "../i18n";

export function IdentityResultCard({ identity }: { identity: { name: string; fingerprint: string; publicKeyJwk: JsonWebKey } }) {
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    addContact({
      name: identity.name,
      fingerprint: identity.fingerprint,
      publicKeyJwk: identity.publicKeyJwk,
      addedAt: Date.now()
    });
    setAdded(true);
  };

  return (
    <div class="result-card structured-card identity-card">
      <div class="card-header">
        <h4 class="card-title">🛡️ {t("identity.cardTitle")}</h4>
      </div>
      <div class="card-body">
        <div class="info-row">
          <span class="info-label">{t("identity.name")}</span>
          <span class="info-value"><strong>{identity.name}</strong></span>
        </div>
        <div class="info-row">
          <span class="info-label">{t("identity.fingerprint")}</span>
          <span class="info-value"><code>{identity.fingerprint}</code></span>
        </div>
      </div>
      <div class="card-actions">
        {added ? (
          <div class="success-banner" style={{ background: "#d1fae5", color: "#065f46", padding: "0.5rem", borderRadius: "4px", textAlign: "center", width: "100%" }}>
            ✓ {t("identity.added")}
          </div>
        ) : (
          <button class="start-btn share-action" onClick={handleAdd} style={{ width: "100%" }}>
            ➕ {t("identity.addContact")}
          </button>
        )}
      </div>
    </div>
  );
}
