import { t } from "../i18n";

interface TransferSummaryProps {
  bytes: number;
  durationSec: number;
  speedBytesPerSec: number;
  detail?: string;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function TransferSummary({ bytes, durationSec, speedBytesPerSec, detail }: TransferSummaryProps) {
  return (
    <div class="transfer-summary" aria-label={t("transfer.summary")}>
      <h4>{t("transfer.summary")}</h4>
      <div class="transfer-stats">
        <div class="stat"><span class="stat-label">{t("transfer.size")}</span><span class="stat-value">{formatBytes(bytes)}</span></div>
        <div class="stat"><span class="stat-label">{t("transfer.duration")}</span><span class="stat-value">{durationSec.toFixed(1)} s</span></div>
        <div class="stat"><span class="stat-label">{t("transfer.speed")}</span><span class="stat-value">{formatBytes(speedBytesPerSec)}/s</span></div>
        {detail && <div class="stat"><span class="stat-label">{t("transfer.details")}</span><span class="stat-value">{detail}</span></div>}
      </div>
    </div>
  );
}
