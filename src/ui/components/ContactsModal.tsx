import { useState, useEffect } from "preact/hooks";
import { getLocalIdentity, type StoredIdentity } from "@/crypto/identity";
import { getContacts, removeContact, importContactsFromJson, exportContactsAsJson, type TrustedContact } from "@/crypto/contacts";
import { renderQRToDataURL } from "@/qr/renderer";
import { t } from "../i18n";

export function ContactsModal({ onClose }: { onClose: () => void }) {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [identityQr, setIdentityQr] = useState<string | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    setContacts(getContacts());
    getLocalIdentity().then(id => {
      setIdentity(id);
      const payload = JSON.stringify({
        qrshare_identity: true,
        name: localDiscoveryName(), // Need to get device name
        fingerprint: id.fingerprint,
        publicKeyJwk: id.publicKeyJwk
      });
      const buffer = new TextEncoder().encode(payload);
      setIdentityQr(renderQRToDataURL(buffer, "balanced"));
    });
  }, []);

  // Helper to read name from localStorage since localDiscovery is not directly injected
  const localDiscoveryName = () => localStorage.getItem("qrshare_device_name") || "QRShare Device";

  const handleRemove = (fingerprint: string) => {
    if (confirm("Remove this trusted contact?")) {
      removeContact(fingerprint);
      setContacts(getContacts());
    }
  };

  const handleExport = () => {
    const json = exportContactsAsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qrshare-contacts.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      if (input.files && input.files.length > 0) {
        try {
          const text = await input.files[0].text();
          const added = importContactsFromJson(text);
          setContacts(getContacts());
          setImportStatus(`Imported ${added} new contacts.`);
          setTimeout(() => setImportStatus(null), 3000);
        } catch (err) {
          setImportStatus("Import failed: Invalid file.");
          setTimeout(() => setImportStatus(null), 3000);
        }
      }
    };
    input.click();
  };

  return (
    <div class="modal-overlay">
      <div class="modal-container contacts-modal" style={{ maxWidth: "500px" }}>
        <div class="view-header" style={{ marginBottom: "1rem" }}>
          <h2>🛡️ {t("contacts.title")}</h2>
          <button class="icon-btn-text" onClick={onClose}>✖️</button>
        </div>

        <div class="contacts-tabs" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          <div class="identity-section" style={{ background: "#f3f4f6", padding: "1rem", borderRadius: "8px", textAlign: "center" }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>{t("contacts.myIdentity")}</h4>
            <p class="settings-hint" style={{ marginBottom: "1rem" }}>{t("contacts.scanHint")}</p>
            {identityQr ? (
              <img src={identityQr} alt="Identity QR Code" style={{ width: "200px", height: "200px", background: "white", padding: "0.5rem", borderRadius: "8px", margin: "0 auto" }} />
            ) : (
              <p>Loading...</p>
            )}
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#4b5563" }}>Fingerprint: <code>{identity?.fingerprint}</code></p>
          </div>

          <div class="contacts-list-section">
            <h4 style={{ margin: "0 0 1rem 0" }}>{t("contacts.listTitle")}</h4>
            {contacts.length === 0 ? (
              <p class="settings-hint">{t("contacts.noContacts")}</p>
            ) : (
              <div class="peers-list" style={{ maxHeight: "250px", overflowY: "auto" }}>
                {contacts.map(c => (
                  <div class="peer-item" key={c.fingerprint} style={{ padding: "0.5rem" }}>
                    <div class="peer-info">
                      <div class="peer-details">
                        <strong class="peer-name">{c.name}</strong>
                        <div class="peer-meta"><code>{c.fingerprint}</code></div>
                      </div>
                    </div>
                    <button class="icon-btn-text" style={{ color: "#ef4444" }} onClick={() => handleRemove(c.fingerprint)} title="Remove">🗑️</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div class="contacts-actions" style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
            <div>
              <button class="start-btn" style={{ background: "#4b5563", padding: "0.5rem 1rem", fontSize: "0.85rem" }} onClick={handleExport}>{t("contacts.export")}</button>
              <button class="start-btn" style={{ background: "#4b5563", padding: "0.5rem 1rem", fontSize: "0.85rem", marginLeft: "0.5rem" }} onClick={handleImport}>{t("contacts.import")}</button>
            </div>
            {importStatus && <span style={{ fontSize: "0.85rem", color: "#059669", alignSelf: "center" }}>{importStatus}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
