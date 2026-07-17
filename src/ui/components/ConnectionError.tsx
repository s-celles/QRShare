import { navigate } from "../router";
import { t } from "../i18n";
import type { ConnectionDiagnosis, DiagnosisCode, IceProbeResult } from "@/webrtc/diagnostics";

const CODE_KEY: Record<DiagnosisCode, string> = {
  "relay-likely-required": "webrtcError.relayLikelyRequired",
  "turn-not-working": "webrtcError.turnNotWorking",
  "peer-unreachable": "webrtcError.peerUnreachable",
  "peer-dropped": "webrtcError.peerDropped",
  "peer-left-deliberately": "webrtcError.peerLeftDeliberately",
  "no-strategy-initialized": "webrtcError.noStrategyInitialized",
  "wrong-room-id": "webrtcError.wrongRoomId",
};

/** Codes the user can actually act on by configuring a relay. */
const TURN_ACTIONABLE: ReadonlySet<DiagnosisCode> = new Set<DiagnosisCode>([
  "relay-likely-required",
  "turn-not-working",
]);

function ProbeDetails({ probe }: { probe: IceProbeResult }) {
  const yn = (v: boolean) => t(v ? "webrtcError.yes" : "webrtcError.no");
  const candidates = probe.candidateTypes.length
    ? probe.candidateTypes.join(", ")
    : t("webrtcError.detailsNone");
  return (
    <dl class="diag-details">
      <dt>{t("webrtcError.detailsCandidates")}</dt>
      <dd>{candidates}</dd>
      <dt>{t("webrtcError.detailsStun")}</dt>
      <dd>{yn(probe.stunReachable)}</dd>
      <dt>{t("webrtcError.detailsTurnConfigured")}</dt>
      <dd>{yn(probe.turnConfigured)}</dd>
      <dt>{t("webrtcError.detailsTurnReachable")}</dt>
      <dd>{yn(probe.turnReachable)}</dd>
      <dt>{t("webrtcError.detailsTimedOut")}</dt>
      <dd>{yn(probe.timedOut)}</dd>
    </dl>
  );
}

/**
 * Render a connection failure. Prefers the machine-readable diagnosis (translated)
 * and falls back to the raw error string when there is none — some failures are
 * plain exceptions (camera denied, etc.) with no classification.
 */
export function ConnectionError({
  diagnosis,
  fallback,
}: {
  diagnosis: ConnectionDiagnosis | null;
  fallback: string | null;
}) {
  if (!diagnosis) {
    return fallback ? (
      <div class="error-msg" role="alert">
        {fallback}
      </div>
    ) : null;
  }

  return (
    <div class="error-msg" role="alert">
      <p>{t(CODE_KEY[diagnosis.code])}</p>

      {/* Never dress up an inference as a fact. */}
      {diagnosis.confidence === "low" && (
        <p class="diag-hedge">{t("webrtcError.lowConfidence")}</p>
      )}

      {TURN_ACTIONABLE.has(diagnosis.code) && (
        <button type="button" class="btn-secondary" onClick={() => navigate("/settings/webrtc")}>
          {t("webrtcError.openTurnSettings")}
        </button>
      )}

      {/* Opt-in detail: shown on failure only, collapsed, never on the happy path. */}
      {diagnosis.probe && (
        <details class="diag-block">
          <summary>{t("webrtcError.details")}</summary>
          <ProbeDetails probe={diagnosis.probe} />
        </details>
      )}
    </div>
  );
}
