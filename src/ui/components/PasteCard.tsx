/**
 * One paste of the board (REQ-PASTE-014 to 016, 022, 023, 040 to 045, 085 to 087):
 * author pseudonym, declared and received times, rendered Markdown (allow-listed)
 * or plain text, attachments shown by their sniffed type only, and the
 * OpenTimestamps proof area.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { t, locale } from "../i18n";
import { saveBlob } from "../save-blob";
import type { Paste } from "@/paste/board";
import { attachmentRefs, renderPasteSafely, type AttachmentView } from "@/paste/markdown";
import { isMedia, isRaster, sniff, sniffedMime } from "@/paste/attachments/sniff";
import { isRiskyExtension } from "@/paste/attachments/filename";
import { inlineImageOk } from "@/paste/attachments/dimensions";
import { toHex } from "@/paste/keys";
import { parseOtsFile, proofSummary, type ProofSummary } from "@/paste/ots/file";
import { currentResults, describeProof, verifiedHeights, type ProofChecks } from "@/paste/ots/status";
import type { AttachmentRef } from "@/paste/statement";

export type AttachmentState = Uint8Array | "loading" | "unavailable";

/** Transient proof state kept by the board view (stamping, results, errors). */
export interface ProofUi {
  busy?: "stamping" | "upgrading" | "checking";
  message?: string;
  error?: string;
  /** Block checks, per (height, commitment), valid only for the proof they were run on. */
  checks?: ProofChecks;
}

export interface PasteCardProps {
  paste: Paste;
  attachment: (hash: Uint8Array) => AttachmentState;
  /** A `blob:` URL of the given type for an attachment (created lazily, revoked on leave). */
  blobUrl: (hashHex: string, bytes: Uint8Array, mime: string) => string;
  /** Re-renders when attachments arrive. */
  blobsVersion: number;
  proofUi?: ProofUi;
  onTimestamp: (paste: Paste) => void;
  onUpgrade: (paste: Paste) => void;
  onCheckBitcoin: (paste: Paste) => void;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "medium" });
}

/** Downloads an attachment as application/octet-stream, after confirmation for risky names (REQ-PASTE-043, 044). */
export function downloadAttachment(ref: AttachmentRef, bytes: Uint8Array): void {
  if (isRiskyExtension(ref.name) && !confirm(t("paste.riskyConfirm", { name: ref.name }))) return;
  saveBlob(bytes, ref.name, "application/octet-stream");
}

function AttachmentChip({ att, state, blobUrl }: { att: AttachmentRef; state: AttachmentState; blobUrl: PasteCardProps["blobUrl"] }) {
  const [playing, setPlaying] = useState(false);
  const hex = toHex(att.hash);
  const bytes = state instanceof Uint8Array ? state : null;
  const kind = bytes ? sniff(bytes.subarray(0, 64)) : "other";
  const media = bytes ? isMedia(kind) : null;
  // inline only real raster images of a sane size matching the signed one (decompression bombs)
  const inline = !!bytes && isRaster(kind) && inlineImageOk(bytes, att);
  const risky = isRiskyExtension(att.name);
  return (
    <div class={`paste-chip ${risky ? "risky" : ""}`}>
      {bytes && inline && (
        <img
          class="paste-inline-img"
          src={blobUrl(hex, bytes, sniffedMime(kind))}
          alt={att.name}
          width={att.width || undefined}
          height={att.height || undefined}
          loading="lazy"
          decoding="async"
        />
      )}
      <div class="paste-chip-row">
        <span aria-hidden="true">{inline ? "🖼" : media === "audio" ? "🎵" : media === "video" ? "🎞" : "📄"}</span>
        <span class="paste-chip-name">{att.name}</span>
        <span class="settings-hint">
          {formatBytes(att.size)} · {att.mime} · <code>{hex.slice(0, 12)}</code>
        </span>
        {state === "loading" && <span class="settings-hint">{t("paste.attLoading")}</span>}
        {state === "unavailable" && <span class="settings-hint">{t("paste.attUnavailable")}</span>}
        {bytes && media && !playing && (
          <button class="paste-btn" onClick={() => setPlaying(true)}>
            ▶ {t("paste.play")}
          </button>
        )}
        {bytes && (
          <button class="paste-btn" onClick={() => downloadAttachment(att, bytes)}>
            {t("common.download")}
          </button>
        )}
      </div>
      {risky && <p class="paste-warning">{t("paste.riskyWarning")}</p>}
      {bytes && playing && media === "audio" && <audio controls preload="none" src={blobUrl(hex, bytes, sniffedMime(kind))} />}
      {bytes && playing && media === "video" && <video class="paste-video" controls preload="none" src={blobUrl(hex, bytes, sniffedMime(kind))} />}
    </div>
  );
}

export function PasteCard(props: PasteCardProps) {
  const { paste, attachment, blobUrl, blobsVersion, proofUi } = props;
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState<ProofSummary | null>(null);
  const idHex = toHex(paste.id);

  useEffect(() => {
    let alive = true;
    if (!paste.proof) setSummary(null);
    else
      void parseOtsFile(paste.proof, Infinity)
        .then((f) => alive && setSummary(proofSummary(f)))
        .catch(() => alive && setSummary(null));
    return () => {
      alive = false;
    };
  }, [paste.proof]);

  const resolve = (hashHex: string): AttachmentView => {
    const ref = paste.attachments.find((a) => toHex(a.hash) === hashHex);
    if (!ref) return { kind: "missing" };
    const state = attachment(ref.hash);
    if (state instanceof Uint8Array) {
      const kind = sniff(state.subarray(0, 64));
      if (isRaster(kind) && inlineImageOk(state, ref)) return { kind: "image", url: blobUrl(hashHex, state, sniffedMime(kind)), width: ref.width, height: ref.height };
    }
    return { kind: "file", hash: hashHex };
  };

  const html = useMemo(
    () =>
      paste.format === "markdown"
        ? renderPasteSafely(paste.source, resolve, {
            labels: { remoteImage: (host) => t("paste.remoteImage", { host }), missing: t("paste.missingAttachment") },
          })
        : null,
    [paste.source, blobsVersion, locale.value],
  );
  const referenced = useMemo(() => new Set(paste.format === "markdown" ? attachmentRefs(paste.source) : []), [paste.source]);
  const below = paste.attachments.filter((a) => !referenced.has(toHex(a.hash)));

  // Chips in the rendered Markdown: download on click (never navigate to a blob: URL).
  const onRenderedClick = (e: MouseEvent) => {
    const chip = (e.target as HTMLElement).closest?.("a.paste-att") as HTMLElement | null;
    if (!chip) return;
    e.preventDefault();
    const ref = paste.attachments.find((a) => toHex(a.hash) === chip.dataset.att);
    const state = ref ? attachment(ref.hash) : "unavailable";
    if (ref && state instanceof Uint8Array) downloadAttachment(ref, state);
    else alert(state === "loading" ? t("paste.attLoading") : t("paste.attUnavailable"));
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(paste.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Bitcoin attestations are claims until a block check matched them; pending calendars are
  // shown next to them, and Upgrade stays available while one of them is allow-listed.
  const checks = proofUi?.checks;
  const view = describeProof(paste.proof ? summary : null, verifiedHeights(checks, paste.proof));
  const results = currentResults(checks, paste.proof);
  const statusParts = (): string[] => {
    if (proofUi?.busy === "stamping") return [t("paste.proofStamping")];
    if (!paste.proof || !summary) return [t("paste.proofNone")];
    const parts: string[] = [];
    if (view.verifiedHeights.length) parts.push(t("paste.proofBitcoin", { heights: view.verifiedHeights.join(", ") }));
    if (view.claimedHeights.length) parts.push(t("paste.proofBitcoinClaimed", { heights: view.claimedHeights.join(", ") }));
    if (view.pendingCalendars.length) parts.push(t("paste.proofPending", { calendars: view.pendingCalendars.map((c) => c.replace(/^https:\/\//, "")).join(", ") }));
    return parts.length ? parts : [t("paste.proofNone")];
  };

  return (
    <article class={`paste-card ${paste.own ? "own" : ""}`} aria-label={t("paste.cardLabel", { name: paste.authorName })}>
      <header class="paste-card-header">
        <span class="paste-author" style={{ color: paste.authorColor }}>
          <span class="paste-dot" style={{ background: paste.authorColor }} aria-hidden="true" />
          {paste.authorName}
        </span>
        <code class="paste-fp">{paste.authorFp}</code>
        {paste.own && <span class="paste-badge">{t("paste.you")}</span>}
        <span class="paste-times">
          <span title={t("paste.declaredHint")}>
            {t("paste.declared", { time: formatTime(paste.declaredAt) })}
          </span>
          {" · "}
          <span>{t("paste.received", { time: formatTime(paste.receivedAt) })}</span>
        </span>
        {paste.future && <span class="paste-badge warn">{t("paste.future")}</span>}
      </header>

      {paste.format === "markdown" && (
        <div class="paste-toolbar">
          <button class="paste-btn" onClick={() => setShowSource(!showSource)} aria-pressed={showSource}>
            {showSource ? t("paste.showRendered") : t("paste.showSource")}
          </button>
          <button class="paste-btn" onClick={() => void copySource()}>
            {copied ? t("paste.copied") : t("paste.copySource")}
          </button>
        </div>
      )}
      {paste.format === "text" && (
        <div class="paste-toolbar">
          <button class="paste-btn" onClick={() => void copySource()}>
            {copied ? t("paste.copied") : t("paste.copySource")}
          </button>
        </div>
      )}

      {paste.format === "text" || showSource || html === null ? (
        <>
          {paste.format === "markdown" && html === null && !showSource && <p class="paste-warning">{t("paste.renderFallback")}</p>}
          <pre class="paste-source">{paste.source}</pre>
        </>
      ) : (
        <div class="paste-rendered" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: html }} />
      )}

      {(paste.format === "text" ? paste.attachments : below).length > 0 && (
        <div class="paste-attachments">
          {(paste.format === "text" ? paste.attachments : below).map((a) => (
            <AttachmentChip key={toHex(a.hash)} att={a} state={attachment(a.hash)} blobUrl={blobUrl} />
          ))}
        </div>
      )}
      {paste.format === "markdown" && paste.attachments.some((a) => referenced.has(toHex(a.hash))) && (
        <details class="paste-att-details">
          <summary>{t("paste.attachmentsInText", { n: paste.attachments.filter((a) => referenced.has(toHex(a.hash))).length })}</summary>
          {paste.attachments
            .filter((a) => referenced.has(toHex(a.hash)))
            .map((a) => (
              <AttachmentChip key={toHex(a.hash)} att={a} state={attachment(a.hash)} blobUrl={blobUrl} />
            ))}
        </details>
      )}

      <footer class="paste-proof">
        <span class="stat-label">{t("paste.proofLabel")}</span>
        <ul class="paste-proof-status">
          {statusParts().map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
        {paste.proofSource !== "none" && (
          <p class="settings-hint">
            {paste.proofSource === "author" ? t("paste.proofFromAuthor") : paste.proofSource === "local" ? t("paste.proofLocal") : t("paste.proofFromBoth")}
          </p>
        )}
        {view.pendingCalendars.length === 1 && !view.claimedHeights.length && !view.verifiedHeights.length && <span class="settings-hint">{t("paste.singleCalendar")}</span>}
        {proofUi?.message && <p class="settings-hint">{proofUi.message}</p>}
        {proofUi?.error && <p class="error-msg">{proofUi.error}</p>}
        {results.map((r) => (
          <p key={`${r.height}:${r.commitmentHex}`} class={r.ok ? "settings-hint" : "error-msg"}>
            {r.ok
              ? t("paste.bitcoinOk", { height: r.height, time: formatTime(r.time * 1000), explorer: r.explorer })
              : r.error
                ? t("paste.bitcoinError", { height: r.height })
                : t("paste.bitcoinMismatch", { height: r.height, explorer: r.explorer })}
          </p>
        ))}
        <div class="paste-toolbar">
          {!paste.proof && (
            <button class="paste-btn" disabled={!!proofUi?.busy} onClick={() => props.onTimestamp(paste)}>
              {t("paste.timestamp")}
            </button>
          )}
          {view.canUpgrade && (
            <button class="paste-btn" disabled={!!proofUi?.busy} onClick={() => props.onUpgrade(paste)}>
              {t("paste.upgrade")}
            </button>
          )}
          {view.canCheckBitcoin && (
            <button class="paste-btn" disabled={!!proofUi?.busy} onClick={() => props.onCheckBitcoin(paste)}>
              {t("paste.checkBitcoin")}
            </button>
          )}
          <details class="paste-downloads">
            <summary>{t("paste.downloads")}</summary>
            <button class="paste-btn" onClick={() => saveBlob(paste.source, `paste-${idHex}.${paste.format === "markdown" ? "md" : "txt"}`, "text/plain;charset=utf-8")}>
              {t("paste.downloadSource")}
            </button>
            <button class="paste-btn" onClick={() => saveBlob(paste.statement, `paste-${idHex}.statement`)}>
              {t("paste.downloadStatement")}
            </button>
            <button class="paste-btn" onClick={() => saveBlob(paste.signature, `paste-${idHex}.statement.sig`)}>
              {t("paste.downloadSignature")}
            </button>
            {paste.proof && (
              <button class="paste-btn" onClick={() => saveBlob(paste.proof!, `paste-${idHex}.statement.ots`)}>
                {t("paste.downloadProof")}
              </button>
            )}
          </details>
        </div>
        <p class="settings-hint paste-proof-caption">{t("paste.proofCaption")}</p>
      </footer>
    </article>
  );
}
