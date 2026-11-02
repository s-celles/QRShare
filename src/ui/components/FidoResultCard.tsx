import type { FidoHybridCode } from "@/qr/fido";
import { t, locale } from "../i18n";

/** Codes older than this are most likely expired: the computer stops waiting after a few minutes. */
const LIKELY_EXPIRED_MS = 5 * 60_000;

/**
 * A passkey sign-in code ("FIDO:/…", REQ-STRUCT-007..009). QRShare cannot sign in
 * itself — that is the phone's passkey manager's job, over Bluetooth near the
 * computer — so it explains the code and offers to hand it to the system.
 */
export function FidoResultCard({ fido, raw }: { fido: FidoHybridCode; raw: string }) {
  const age = fido.createdAt ? Date.now() - fido.createdAt.getTime() : null;
  const requestKey =
    fido.request === "sign-in" ? "fido.requestSignIn" : fido.request === "register" ? "fido.requestRegister" : "fido.requestUnknown";

  return (
    <div class="result-card structured-card fido-card">
      <div class="card-header">
        <h4 class="card-title">🔑 {t("fido.cardTitle")}</h4>
        <span class="card-badge">FIDO</span>
      </div>
      <p class="fido-explanation">{t("fido.explanation")}</p>
      <div class="card-body">
        <div class="info-row">
          <span class="info-label">{t("fido.request")}</span>
          <span class="info-value"><strong>{t(requestKey)}</strong></span>
        </div>
        {fido.createdAt && (
          <div class="info-row">
            <span class="info-label">{t("fido.created")}</span>
            <span class="info-value">{fido.createdAt.toLocaleString(locale.value)}</span>
          </div>
        )}
      </div>
      {age !== null && age > LIKELY_EXPIRED_MS && <p class="fido-expired" role="status">{t("fido.likelyExpired")}</p>}
      <p class="fido-warning" role="note">⚠️ {t("fido.doNotForward")}</p>
      <div class="card-actions">
        {/* Where the system handles passkey codes (e.g. Android), it takes over; elsewhere nothing happens. */}
        <a class="start-btn share-action" href={raw}>
          {t("fido.openWithDevice")}
        </a>
      </div>
    </div>
  );
}
