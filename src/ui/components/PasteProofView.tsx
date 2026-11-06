/**
 * "Check a proof" (REQ-PASTE-092 to 094): usable without joining a board. Takes a
 * paste statement, its `.ots` proof and optionally its signature and attachment
 * files; checks everything that can be checked offline, upgrades the proof and
 * checks Bitcoin attestations through a block explorer.
 */
import { useState } from "preact/hooks";
import { navigate } from "../router";
import { t } from "../i18n";
import { saveBlob } from "../save-blob";
import { toHex } from "@/paste/keys";
import { renderPasteSafely } from "@/paste/markdown";
import { serializeOtsFile } from "@/paste/ots/file";
import { upgradeProof } from "@/paste/ots/calendar";
import { describeProof } from "@/paste/ots/status";
import { checkBitcoinAttestation, checkProof, checkStatement, type ProofCheck, type StatementCheck } from "@/paste/ots/verify";
import { formatBytes, formatTime } from "./PasteCard";

const read = async (file: File) => new Uint8Array(await file.arrayBuffer());

export function PasteProofView() {
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [otsFile, setOtsFile] = useState<File | null>(null);
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [statement, setStatement] = useState<StatementCheck | null>(null);
  const [proof, setProof] = useState<ProofCheck | null>(null);
  const [proofBytes, setProofBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Block check messages per "height:commitment". */
  const [bitcoin, setBitcoin] = useState<Record<string, string>>({});
  const [statementBytes, setStatementBytes] = useState<Uint8Array | null>(null);

  const check = async () => {
    setError("");
    setMessage("");
    setBitcoin({});
    setStatement(null);
    setProof(null);
    if (!statementFile) return;
    try {
      const bytes = await read(statementFile);
      setStatementBytes(bytes);
      setStatement(
        await checkStatement(bytes, {
          signature: sigFile ? await read(sigFile) : undefined,
          attachments: await Promise.all(attachmentFiles.map(async (f) => ({ name: f.name, bytes: await read(f) }))),
        }),
      );
      if (otsFile) {
        const ots = await read(otsFile);
        setProofBytes(ots);
        setProof(await checkProof(bytes, ots));
      }
    } catch (err) {
      setError(t("pasteProof.readFailed", { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const upgrade = async () => {
    if (!proof || !statementBytes) return;
    setBusy(true);
    try {
      const result = await upgradeProof(proof.file);
      const bytes = serializeOtsFile(result.file);
      if (result.changed) setBitcoin({}); // results belong to the previous proof
      setProofBytes(bytes);
      setProof(await checkProof(statementBytes, bytes));
      const parts = [result.changed ? t("paste.upgraded") : t("paste.stillPending")];
      if (result.skipped.length) parts.push(t("paste.skippedCalendars", { calendars: result.skipped.join(", ") }));
      setMessage(parts.join(" "));
    } catch {
      setError(t("paste.upgradeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const checkBitcoin = async (height: number, commitmentHex: string) => {
    setBusy(true);
    try {
      const commitment = Uint8Array.from(commitmentHex.match(/../g)!.map((h) => parseInt(h, 16)));
      const r = await checkBitcoinAttestation(height, commitment);
      const host = new URL(r.explorer).host;
      setBitcoin((all) => ({
        ...all,
        [`${height}:${commitmentHex}`]: r.ok ? t("paste.bitcoinOk", { height, time: formatTime(r.time * 1000), explorer: host }) : t("paste.bitcoinMismatch", { height, explorer: host }),
      }));
    } catch {
      setError(t("paste.explorerFailed"));
    } finally {
      setBusy(false);
    }
  };

  const fields = statement?.fields;
  const idHex = statement ? toHex(statement.id) : "";
  const rendered =
    fields?.format === "markdown"
      ? renderPasteSafely(fields.source, (hash) => (fields.attachments.some((a) => toHex(a.hash) === hash) ? { kind: "file", hash } : { kind: "missing" }), {
          labels: { remoteImage: (host) => t("paste.remoteImage", { host }), missing: t("paste.missingAttachment") },
        })
      : null;

  return (
    <section aria-label={t("pasteProof.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/paste")} aria-label={t("common.back")}>
          ← {t("common.back")}
        </button>
        <h2>{t("pasteProof.heading")}</h2>
      </div>
      <p class="settings-hint">{t("pasteProof.hint")}</p>
      <form
        class="creator-content paste-proof-form"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <label>
          {t("pasteProof.statementFile")}
          <input type="file" accept=".statement" onChange={(e) => setStatementFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        <label>
          {t("pasteProof.otsFile")}
          <input type="file" accept=".ots" onChange={(e) => setOtsFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        <label>
          {t("pasteProof.sigFile")}
          <input type="file" accept=".sig" onChange={(e) => setSigFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        <label>
          {t("pasteProof.attachmentFiles")}
          <input type="file" multiple onChange={(e) => setAttachmentFiles([...((e.target as HTMLInputElement).files ?? [])])} />
        </label>
        <button type="submit" class="start-btn" disabled={!statementFile}>
          {t("pasteProof.check")}
        </button>
      </form>
      {error && <div class="error-msg" role="alert">{error}</div>}

      {statement && (
        <div class="paste-card">
          <h3>{t("pasteProof.statement")}</h3>
          {statement.error ? (
            <p class="error-msg">{t("pasteProof.badStatement", { error: statement.error })}</p>
          ) : (
            <ul class="paste-checks">
              <li>
                {t("paste.pasteId")} <code>{idHex}</code>
              </li>
              <li>
                {t("pasteProof.author", { name: statement.pseudonym ?? "", fp: statement.fingerprint ?? "" })}
              </li>
              <li>{t("paste.declared", { time: fields ? formatTime(fields.declaredAt) : "" })} — {t("paste.declaredHint")}</li>
              <li class={statement.signature === "invalid" ? "error-msg" : ""}>
                {statement.signature === "valid" ? t("pasteProof.sigValid") : statement.signature === "invalid" ? t("pasteProof.sigInvalid") : t("pasteProof.sigNotChecked")}
              </li>
              {statement.attachments.map((a) => (
                <li key={toHex(a.ref.hash)} class={a.status === "match" ? "" : "settings-hint"}>
                  {a.ref.name} ({formatBytes(a.ref.size)}, <code>{toHex(a.ref.hash).slice(0, 12)}</code>):{" "}
                  {a.status === "match" ? t("pasteProof.attMatch", { file: a.file ?? "" }) : t("pasteProof.attMissing")}
                </li>
              ))}
              {statement.extraFiles.length > 0 && <li class="settings-hint">{t("pasteProof.extraFiles", { files: statement.extraFiles.join(", ") })}</li>}
            </ul>
          )}
          {fields &&
            (rendered !== null ? (
              <div class="paste-rendered" dangerouslySetInnerHTML={{ __html: rendered }} onClick={(e) => (e.target as HTMLElement).closest?.("a.paste-att") && e.preventDefault()} />
            ) : (
              <pre class="paste-source">{fields.source}</pre>
            ))}
        </div>
      )}

      {proof && (
        <div class="paste-card">
          <h3>{t("pasteProof.proof")}</h3>
          <p class={proof.digestMatches ? "" : "error-msg"}>{proof.digestMatches ? t("pasteProof.digestOk") : t("pasteProof.digestMismatch")}</p>
          <ul class="paste-checks">
            {proof.attestations.map((a, i) => (
              <li key={i}>
                {a.kind === "pending" && t("pasteProof.attPending", { uri: a.uri ?? "" })}
                {a.kind === "bitcoin" && t("pasteProof.attBitcoin", { height: a.height ?? 0 })}
                {a.kind === "unknown" && t("pasteProof.attUnknown")}
                {!a.supported && a.kind !== "unknown" && <span class="settings-hint"> {t("pasteProof.unsupported")}</span>}
                {a.kind === "bitcoin" && a.commitmentHex && (
                  <button class="paste-btn" disabled={busy} onClick={() => void checkBitcoin(a.height!, a.commitmentHex!)}>
                    {t("paste.checkBitcoin")}
                  </button>
                )}
                {a.kind === "bitcoin" && bitcoin[`${a.height}:${a.commitmentHex}`] && <p class="settings-hint">{bitcoin[`${a.height}:${a.commitmentHex}`]}</p>}
              </li>
            ))}
          </ul>
          {proof.summary.unsupported && <p class="paste-warning">{t("pasteProof.unsupportedHint")}</p>}
          <p class="settings-hint">{t("paste.explorerTrust")}</p>
          {message && <p class="settings-hint">{message}</p>}
          <div class="paste-toolbar">
            {describeProof(proof.summary, []).canUpgrade && (
              <button class="paste-btn" disabled={busy} onClick={() => void upgrade()}>
                {t("paste.upgrade")}
              </button>
            )}
            {proofBytes && (
              <button class="paste-btn" onClick={() => saveBlob(proofBytes, `paste-${idHex}.statement.ots`)}>
                {t("pasteProof.downloadOts")}
              </button>
            )}
          </div>
          <p class="settings-hint paste-proof-caption">{t("paste.proofCaption")}</p>
        </div>
      )}
    </section>
  );
}
