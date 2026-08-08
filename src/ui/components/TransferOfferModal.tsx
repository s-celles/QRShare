import { useState, useEffect } from "preact/hooks";
import { localDiscovery, type TransferOffer } from "@/webrtc/discovery";
import { t } from "../i18n";

export function TransferOfferModal() {
  const [currentOffer, setCurrentOffer] = useState<TransferOffer | null>(null);

  useEffect(() => {
    const update = () => {
      const offers = localDiscovery.activeOffers.value;
      setCurrentOffer(offers.length > 0 ? offers[0] : null);
    };
    update();

    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!currentOffer) return null;

  const handleAccept = () => {
    localDiscovery.respondToOffer(currentOffer, true);
    // Connect to receiver WebRTC mode directly
    window.location.hash = `#/receive/webrtc?offer=${currentOffer.transferId}`;
  };

  const handleDecline = () => {
    localDiscovery.respondToOffer(currentOffer, false);
  };

  const sizeText = (currentOffer.size / 1024).toFixed(1) + " KB";

  return (
    <div class="modal-overlay">
      <div class="modal-container offer-modal-container">
        <div class="offer-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>📱 {t("discovery.offerTitle")}</h3>
            {currentOffer.verified && currentOffer.fingerprint && (
              <div class="verified-badge" style={{ fontSize: "0.75rem", color: "#059669", background: "#d1fae5", padding: "2px 6px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "4px" }} title="Cryptographically Verified Identity">
                🛡️ {currentOffer.fingerprint}
              </div>
            )}
          </div>
          <p class="offer-hint">
            {t("discovery.offerHint", {
              name: currentOffer.senderName,
              filename: currentOffer.filename,
              size: sizeText,
            })}
          </p>

          <div class="modal-actions">
            <button class="start-btn download-action" onClick={handleAccept}>
              {t("discovery.accept")}
            </button>
            <button class="stop-btn" onClick={handleDecline}>
              {t("discovery.decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
