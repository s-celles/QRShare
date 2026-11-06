/**
 * Paste board (Experimental, network): create or join a board, compose pastes
 * with attachments, export, and timestamp pastes with OpenTimestamps
 * (REQ-PASTE-001 to 003, 006, 007, 028, 030 to 033, 056, 080, 106, 110).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { hashParams, navigate } from "../router";
import { t } from "../i18n";
import { saveBlob } from "../save-blob";
import { renderQRToDataURL } from "@/qr/renderer";
import type { Paste } from "@/paste/board";
import { codeToSecret, newRoomSecret, normalizeCode, pasteLink } from "@/paste/code";
import { supportsEd25519, toHex } from "@/paste/keys";
import { JoinGate, openBoardSession, type BoardSession } from "@/paste/session";
import { MAX_ATTACHMENTS, MAX_SOURCE_BYTES, normalizeSource, utf8Length, type PasteFormat } from "@/paste/statement";
import { renderPasteSafely, type AttachmentView } from "@/paste/markdown";
import { prepareAttachment, type PreparedFile } from "@/paste/attachments/reencode";
import { exportBoardMarkdown, exportBoardZip, exportFileName } from "@/paste/export";
import { parseOtsFile, proofSummary, serializeOtsFile, type ProofSummary } from "@/paste/ots/file";
import { stampDigest, upgradeProof } from "@/paste/ots/calendar";
import { checkBitcoinAttestations } from "@/paste/ots/verify";
import { verifiedHeights } from "@/paste/ots/status";
import { PasteCard, formatBytes, type ProofUi } from "./PasteCard";

type Phase = "start" | "connecting" | "board" | "unsupported";

export function PasteBoardView() {
  const [phase, setPhase] = useState<Phase>("start");
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [code, setCode] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [peers, setPeers] = useState(0);
  const [ignored, setIgnored] = useState(0);
  const [full, setFull] = useState(false);
  const [blobsVersion, setBlobsVersion] = useState(0);
  const [format, setFormat] = useState<PasteFormat>("markdown");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [attachError, setAttachError] = useState("");
  const [postError, setPostError] = useState("");
  const [coolDown, setCoolDown] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [consent, setConsent] = useState<{ paste: Paste } | null>(null);
  const [proofUi, setProofUi] = useState<Record<string, ProofUi>>({});
  const session = useRef<BoardSession | null>(null);
  const gate = useRef(new JoinGate()).current;
  const consented = useRef(false);
  const urls = useRef(new Map<string, string>());
  const textarea = useRef<HTMLTextAreaElement>(null);

  /** blob: URLs typed with the sniffed MIME type, created once per attachment and type. */
  const blobUrl = (hashHex: string, bytes: Uint8Array, mime: string): string => {
    const key = `${hashHex}:${mime}`;
    let url = urls.current.get(key);
    if (!url) {
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      urls.current.set(key, url);
    }
    return url;
  };

  const revokeAll = () => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
  };

  const leave = async () => {
    gate.cancel(); // a join still connecting tears itself down
    const s = session.current;
    session.current = null;
    if (s) await s.close();
    revokeAll();
    setPastes([]);
    setPeers(0);
    setIgnored(0);
    setFull(false);
    setFiles([]);
    setDraft("");
    setCode("");
    setShowQr(false);
    setProofUi({});
    consented.current = false;
    setPhase("start");
  };

  const join = async (secret: Uint8Array) => {
    const token = gate.begin();
    if (token === null) return; // a join is already running (double click)
    setError("");
    setPhase("connecting");
    try {
      if (!(await supportsEd25519())) {
        if (gate.isCurrent(token)) setPhase("unsupported");
        return;
      }
      const s = await openBoardSession(secret, { isCurrent: () => gate.isCurrent(token) });
      if (!s) return; // left or unmounted meanwhile: already torn down
      s.board.on("change", setPastes);
      s.board.on("peers", setPeers);
      s.board.on("ignored", setIgnored);
      s.board.on("full", setFull);
      s.board.on("blobs", () => setBlobsVersion((v) => v + 1));
      session.current = s;
      setCode(s.code);
      setPhase("board");
    } catch (err) {
      if (gate.isCurrent(token)) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("start");
      }
    } finally {
      gate.end(token);
    }
  };

  // A paste-board link: read the code, then remove the secret from the address bar (REQ-PASTE-003).
  const params = hashParams.value;
  useEffect(() => {
    const k = params.get("k");
    if (!k) return;
    history.replaceState(null, "", `${location.pathname}${location.search}#/paste`);
    hashParams.value = new URLSearchParams();
    const secret = codeToSecret(k);
    if (!secret) setError(t("paste.badCode"));
    else void leave().then(() => join(secret));
  }, [params]);

  useEffect(() => {
    const onHide = () => void leave();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void leave();
    };
  }, []);

  const addFiles = async (list: FileList | File[] | null | undefined) => {
    if (!list) return;
    setAttachError("");
    const incoming = [...list];
    if (files.length + incoming.length > MAX_ATTACHMENTS) {
      setAttachError(t("paste.tooManyAttachments", { max: MAX_ATTACHMENTS }));
      return;
    }
    const prepared: PreparedFile[] = [];
    for (const file of incoming) {
      const result = await prepareAttachment(file);
      if ("error" in result) {
        setAttachError(result.error === "too-large" ? t("paste.attachmentTooLarge", { name: file.name }) : t("paste.imageFailed", { name: file.name }));
        continue;
      }
      prepared.push(result);
      if (format === "markdown") insertAtCaret(result.kind === "image" ? `![${result.attachment.name}](attachment:${result.hash})` : `[${result.attachment.name}](attachment:${result.hash})`);
    }
    setFiles((current) => [...current, ...prepared.filter((p) => !current.some((c) => c.hash === p.hash))]);
  };

  const insertAtCaret = (text: string) => {
    const el = textarea.current;
    setDraft((current) => {
      const at = el ? el.selectionStart : current.length;
      const end = el ? el.selectionEnd : current.length;
      const sep = at > 0 && current[at - 1] !== "\n" ? "\n" : "";
      return normalizeSource(current.slice(0, at) + sep + text + "\n" + current.slice(end));
    });
  };

  const post = async () => {
    const board = session.current?.board;
    if (!board) return;
    setPostError("");
    const result = await board.post({ format, source: draft, attachments: files.map((f) => f.attachment) });
    if ("error" in result) {
      setPostError(
        result.error === "rate"
          ? t("paste.postErrorRate")
          : result.error === "full"
            ? t("paste.postErrorFull")
            : result.error === "too-many-attachments"
              ? t("paste.tooManyAttachments", { max: MAX_ATTACHMENTS })
              : t("paste.postErrorTooLarge"),
      );
      return;
    }
    setDraft("");
    setFiles([]);
    setPreview(false);
    setCoolDown(true);
    setTimeout(() => setCoolDown(false), 3_000);
  };

  // ------------------------------------------------------------------ proofs

  // explorer results are kept across later messages: they decide "verified" in the card and export
  // (the checks carry the proof they ran on: they no longer count once the proof changes)
  const updateProof = (id: string, ui: ProofUi) => setProofUi((all) => ({ ...all, [id]: { checks: all[id]?.checks, ...ui } }));
  const exportVerifiedHeights = () => new Map(pastes.map((p) => [toHex(p.id), verifiedHeights(proofUi[toHex(p.id)]?.checks, p.proof)]));

  const timestamp = async (paste: Paste) => {
    if (!consented.current) {
      setConsent({ paste });
      return;
    }
    const id = toHex(paste.id);
    updateProof(id, { busy: "stamping" });
    try {
      const result = await stampDigest(paste.id);
      const stored = await session.current?.board.attachProof(paste.id, serializeOtsFile(result.file));
      if (stored === "invalid") {
        saveBlob(serializeOtsFile(result.file), `paste-${id}.statement.ots`);
        updateProof(id, { error: t("paste.proofNotStored") });
        return;
      }
      const parts = [result.succeeded.length === 1 ? t("paste.singleCalendar") : t("paste.stamped", { n: result.succeeded.length })];
      if (stored === "replaced") parts.push(t("paste.proofReplaced"));
      if (stored === "local") parts.push(t("paste.proofLocalOnly"));
      updateProof(id, { message: parts.join(" ") });
    } catch {
      updateProof(id, { error: t("paste.stampFailed") });
    }
  };

  const upgrade = async (paste: Paste) => {
    const id = toHex(paste.id);
    if (!paste.proof) return;
    updateProof(id, { busy: "upgrading" });
    try {
      const result = await upgradeProof(await parseOtsFile(paste.proof, Infinity));
      const stored = result.changed ? await session.current?.board.attachProof(paste.id, serializeOtsFile(result.file)) : undefined;
      const parts = [result.changed ? t("paste.upgraded") : t("paste.stillPending")];
      if (stored === "replaced") parts.push(t("paste.proofReplaced"));
      if (stored === "local") parts.push(t("paste.proofLocalOnly"));
      if (stored === "invalid") parts.push(t("paste.proofNotStored"));
      if (result.skipped.length) parts.push(t("paste.skippedCalendars", { calendars: result.skipped.join(", ") }));
      updateProof(id, { message: parts.join(" ") });
    } catch {
      updateProof(id, { error: t("paste.upgradeFailed") });
    }
  };

  const checkBitcoin = async (paste: Paste) => {
    const id = toHex(paste.id);
    const proof = paste.proof;
    if (!proof) return;
    updateProof(id, { busy: "checking" });
    try {
      // one result per (height, commitment); a failed lookup does not stop the others
      const results = await checkBitcoinAttestations(await parseOtsFile(proof, Infinity));
      updateProof(id, { checks: { proof, results }, message: t("paste.explorerTrust") });
    } catch {
      updateProof(id, { error: t("paste.explorerFailed") });
    }
  };

  // ------------------------------------------------------------------ export

  const proofSummaries = async (): Promise<Map<string, ProofSummary>> => {
    const map = new Map<string, ProofSummary>();
    for (const p of pastes) {
      if (!p.proof) continue;
      try {
        map.set(toHex(p.id), proofSummary(await parseOtsFile(p.proof, Infinity)));
      } catch {
        /* unreadable proof: exported as none */
      }
    }
    return map;
  };

  const exportBoard = async (kind: "zip" | "md") => {
    const board = session.current?.board;
    if (!board) return;
    const exportedAt = Date.now();
    const proofs = await proofSummaries();
    if (kind === "zip") {
      const blobs = (hex: string) => {
        const ref = pastes.flatMap((p) => p.attachments).find((a) => toHex(a.hash) === hex);
        const state = ref ? board.attachment(ref.hash) : "unavailable";
        return state instanceof Uint8Array ? state : undefined;
      };
      saveBlob(exportBoardZip(pastes, blobs, { exportedAt, proofs, verifiedHeights: exportVerifiedHeights() }), exportFileName(exportedAt, "zip"), "application/zip");
    } else {
      saveBlob(
        exportBoardMarkdown(pastes, { exportedAt, attachments: "placeholders", proofs, verifiedHeights: exportVerifiedHeights() }),
        exportFileName(exportedAt, "md"),
        "text/markdown;charset=utf-8",
      );
    }
    setExportOpen(false);
  };

  // ------------------------------------------------------------------ render

  const draftBytes = utf8Length(draft);
  const board = session.current?.board;
  const zipDefault = pastes.some((p) => p.attachments.length > 0 || p.proof);
  const previewResolve = (hashHex: string): AttachmentView => {
    const f = files.find((x) => x.hash === hashHex);
    if (!f) return { kind: "missing" };
    if (f.kind === "image") return { kind: "image", url: blobUrl(f.hash, f.attachment.bytes, f.attachment.mime), width: f.attachment.width, height: f.attachment.height };
    return { kind: "file", hash: hashHex };
  };
  const previewHtml = preview && format === "markdown" ? renderPasteSafely(draft, previewResolve, { labels: { remoteImage: (host) => t("paste.remoteImage", { host }), missing: t("paste.missingAttachment") } }) : null;
  const link = code ? pasteLink(location.href, code) : "";

  return (
    <section aria-label={t("paste.section")}>
      <div class="view-header">
        <button onClick={() => { void leave(); navigate("/"); }} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t("paste.heading")}</h2>
      </div>
      <p class="settings-hint">{t("paste.hint")}</p>
      {error && <div class="error-msg" role="alert">{error}</div>}

      {phase === "unsupported" && (
        <div class="error-msg" role="alert">
          {t("paste.unsupported")}
          <button class="paste-btn" onClick={() => setPhase("start")}>{t("common.back")}</button>
        </div>
      )}

      {phase === "start" && (
        <div class="creator-content">
          <div class="mode-grid">
            <div class="mode-btn mode-btn--send">
              <span class="mode-label">{t("paste.create")}</span>
              <span class="mode-desc">{t("paste.createDesc")}</span>
              <button class="start-btn" disabled={phase !== "start"} onClick={() => void join(newRoomSecret())}>{t("paste.createButton")}</button>
            </div>
            <form
              class="mode-btn mode-btn--receive"
              onSubmit={(e) => {
                e.preventDefault();
                const normal = normalizeCode(joinCode);
                const secret = normal && codeToSecret(normal);
                if (secret) void join(secret);
                else setError(t("paste.badCode"));
              }}
            >
              <span class="mode-label">{t("paste.join")}</span>
              <span class="mode-desc">{t("paste.joinDesc")}</span>
              <input
                class="creator-input-field paste-code-input"
                value={joinCode}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellcheck={false}
                aria-label={t("paste.codeLabel")}
                onInput={(e) => setJoinCode((e.target as HTMLInputElement).value)}
              />
              <button type="submit" class="start-btn" disabled={phase !== "start"}>{t("paste.joinButton")}</button>
            </form>
          </div>
          <div class="paste-toolbar">
            <button class="paste-btn" onClick={() => navigate("/scan")}>{t("paste.scan")}</button>
            <button class="paste-btn" onClick={() => navigate("/paste/verify")}>{t("paste.checkProof")}</button>
          </div>
        </div>
      )}

      {phase === "connecting" && (
        <div class="creator-content">
          <p role="status">{t("paste.connecting")}</p>
          <button class="stop-btn" onClick={() => void leave()}>{t("common.cancel")}</button>
        </div>
      )}

      {phase === "board" && board && (
        <div class="paste-board">
          <div class="paste-board-header">
            <span class="stat-label">{t("paste.codeLabel")}</span>
            <code class="paste-code">{code}</code>
            <button class="paste-btn" onClick={() => setShowQr(!showQr)} aria-expanded={showQr}>
              {showQr ? t("paste.hideQr") : t("paste.showQr")}
            </button>
            <span role="status">{t("paste.peers", { n: peers })}</span>
            {ignored > 0 && <span class="paste-badge warn">{t("paste.ignoredPeers", { n: ignored })}</span>}
            <button class="paste-btn" onClick={() => setExportOpen(!exportOpen)} disabled={!pastes.length}>{t("paste.export")}</button>
            <button class="stop-btn" onClick={() => void leave()}>{t("paste.leave")}</button>
          </div>
          {showQr && (
            <div class="paste-qr">
              <img src={renderQRToDataURL(new TextEncoder().encode(link), "balanced")} alt={t("paste.qrAlt")} />
              <p class="settings-hint">{t("paste.qrHint")}</p>
            </div>
          )}
          {exportOpen && (
            <div class="paste-export" role="dialog" aria-label={t("paste.export")}>
              <p class="settings-hint">{t("paste.exportHint")}</p>
              <button class={zipDefault ? "start-btn" : "paste-btn"} onClick={() => void exportBoard("zip")}>{t("paste.exportZip")}</button>
              <button class={zipDefault ? "paste-btn" : "start-btn"} onClick={() => void exportBoard("md")}>{t("paste.exportMarkdown")}</button>
            </div>
          )}
          <p class="settings-hint paste-ephemeral">{t("paste.ephemeral")}</p>
          {full && <p class="error-msg" role="status">{t("paste.full")}</p>}

          <form
            class="paste-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void post();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles(e.dataTransfer?.files);
            }}
          >
            <div class="paste-toolbar" role="radiogroup" aria-label={t("paste.format")}>
              <label>
                <input type="radio" name="paste-format" checked={format === "markdown"} onChange={() => setFormat("markdown")} /> {t("paste.formatMarkdown")}
              </label>
              <label>
                <input type="radio" name="paste-format" checked={format === "text"} onChange={() => { setFormat("text"); setPreview(false); }} /> {t("paste.formatText")}
              </label>
              {format === "markdown" && (
                <button type="button" class="paste-btn" onClick={() => setPreview(!preview)} aria-pressed={preview}>
                  {preview ? t("paste.edit") : t("paste.preview")}
                </button>
              )}
            </div>
            {previewHtml !== null && preview ? (
              <div class="paste-rendered paste-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : preview && format === "markdown" ? (
              <p class="paste-warning">{t("paste.renderFallback")}</p>
            ) : (
              <textarea
                ref={textarea}
                class="creator-input-field paste-textarea"
                rows={6}
                value={draft}
                placeholder={t("paste.placeholder")}
                aria-label={t("paste.placeholder")}
                onInput={(e) => setDraft(normalizeSource((e.target as HTMLTextAreaElement).value))}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.files;
                  if (pasted && pasted.length) {
                    e.preventDefault();
                    void addFiles(pasted);
                  }
                }}
              />
            )}
            <div class="paste-toolbar">
              <span class={`settings-hint ${draftBytes > MAX_SOURCE_BYTES ? "error-msg" : ""}`}>
                {t("paste.bytes", { used: draftBytes, max: MAX_SOURCE_BYTES })}
              </span>
              <label class="paste-btn paste-attach">
                {t("paste.attach")}
                <input type="file" multiple hidden onChange={(e) => { void addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ""; }} />
              </label>
            </div>
            {attachError && <p class="error-msg" role="alert">{attachError}</p>}
            {files.length > 0 && (
              <ul class="paste-pending-files">
                {files.map((f) => (
                  <li key={f.hash}>
                    <span>{f.attachment.name}</span>{" "}
                    <span class="settings-hint">
                      {f.reencoded
                        ? t("paste.reencoded", { width: f.attachment.width, height: f.attachment.height, size: formatBytes(f.attachment.bytes.length), original: formatBytes(f.originalSize) })
                        : formatBytes(f.attachment.bytes.length)}
                    </span>
                    {f.metadataWarning && <p class="paste-warning">{t("paste.metadataWarning")}</p>}
                    <button type="button" class="paste-btn" onClick={() => setFiles((all) => all.filter((x) => x.hash !== f.hash))}>
                      {t("paste.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {postError && <p class="error-msg" role="alert">{postError}</p>}
            <button type="submit" class="start-btn" disabled={coolDown || !draft.trim() || draftBytes > MAX_SOURCE_BYTES}>
              {coolDown ? t("paste.coolDown") : t("paste.post")}
            </button>
          </form>

          {consent && (
            <div class="paste-consent" role="dialog" aria-label={t("paste.consentTitle")}>
              <h3>{t("paste.consentTitle")}</h3>
              <p>{t("paste.consentBody")}</p>
              <button
                class="start-btn"
                onClick={() => {
                  consented.current = true;
                  const p = consent.paste;
                  setConsent(null);
                  void timestamp(p);
                }}
              >
                {t("paste.consentAccept")}
              </button>
              <button class="paste-btn" onClick={() => setConsent(null)}>{t("common.cancel")}</button>
            </div>
          )}

          {pastes.length === 0 && <p class="settings-hint">{t("paste.empty")}</p>}
          <div class="paste-list">
            {pastes.map((p) => (
              <PasteCard
                key={toHex(p.id)}
                paste={p}
                attachment={(hash) => board.attachment(hash)}
                blobUrl={blobUrl}
                blobsVersion={blobsVersion}
                proofUi={proofUi[toHex(p.id)]}
                onTimestamp={(x) => void timestamp(x)}
                onUpgrade={(x) => void upgrade(x)}
                onCheckBitcoin={(x) => void checkBitcoin(x)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
