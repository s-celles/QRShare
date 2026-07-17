import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { navigate } from "../router";
import { t } from "../i18n";
import { activeCollabService, activeCollabRoomId, leaveCollab } from "@/collab/handoff";
import { pendingText } from "../shared-file";
import type { CollabSession, CollabRoom } from "@/collab/session";

/** Soft document limit, consistent with text-sharing (REQ-COLLAB-051). */
const CHAR_LIMIT = 100_000;

// Module-scoped reactive state (mirrors the WebRTC view conventions).
const ready = signal(false);
const loadError = signal<string | null>(null);
const versionLabel = signal("");

export function CollabEditorView() {
  const sessionRef = useRef<CollabSession | null>(null);

  useEffect(() => {
    const svc = activeCollabService.value;
    if (!svc || !svc.getRoom()) {
      loadError.value = t("collab.noSession");
      return;
    }

    let disposed = false;
    // Lazy-load the Yjs-backed collab modules so they are only evaluated on this
    // route (approved decision 4 / bundle-size mitigation).
    void Promise.all([
      import("@/collab/session"),
      import("@/collab/persistence"),
    ]).then(async ([{ CollabSession }, persistence]) => {
      if (disposed) return;
      const room = svc.getRoom();
      if (!room) {
        loadError.value = t("collab.noSession");
        return;
      }
      // The trystero Room satisfies CollabRoom structurally at runtime; the cast
      // bridges trystero's stricter generic makeAction signature.
      const session = new CollabSession(room as unknown as CollabRoom, {
        siteId: svc.getSelfId(),
      });
      sessionRef.current = session;

      // Restore the persisted document + version log so a reload rejoins the
      // session (REQ-COLLAB-060..062). No-ops when IndexedDB is unavailable.
      const roomId = activeCollabRoomId.value;
      if (roomId && persistence.isPersistenceAvailable()) {
        try {
          await persistence.attachDocPersistence(roomId, session.doc);
          const saved = await persistence.loadVersionEntries(roomId);
          for (const entry of saved) session.versionLog.receive(entry);
          session.versions.value = session.versionLog.entries();
        } catch {
          /* persistence is best-effort */
        }
        if (disposed) return;
        // Persist every future version save/receive.
        session.versions.subscribe((entries) => {
          for (const entry of entries) {
            void persistence.saveVersionEntry(roomId, entry);
          }
        });
      }

      // If a peer is already present, kick off the resync handshake.
      if (svc.peerOnline.value) session.startHandshake();
      ready.value = true;
    });

    return () => {
      disposed = true;
      sessionRef.current?.destroy();
      sessionRef.current = null;
      ready.value = false;
      loadError.value = null;
      versionLabel.value = "";
      // The editor owns the connection once it has been handed off (the WebRTC
      // view deliberately skips its own teardown), so releasing it is our job.
      leaveCollab();
    };
  }, []);

  const svc = activeCollabService.value;
  const session = sessionRef.current;

  if (loadError.value) {
    return (
      <section aria-label={t("collab.section")}>
        <div class="view-header">
          <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
            {"← " + t("common.back")}
          </button>
          <h2>{t("collab.heading")}</h2>
        </div>
        <div class="error-msg" role="alert">
          {loadError.value}
        </div>
      </section>
    );
  }

  if (!ready.value || !session) {
    return (
      <section aria-label={t("collab.section")}>
        <div class="view-header">
          <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
            {"← " + t("common.back")}
          </button>
          <h2>{t("collab.heading")}</h2>
        </div>
        <p>{t("collab.connecting")}</p>
      </section>
    );
  }

  const text = session.docText.value;
  const count = text.length;
  const overLimit = count >= CHAR_LIMIT;
  const peerOnline = svc?.peerOnline.value ?? false;
  const strategy = svc?.activeStrategy.value;
  const versions = session.versions.value;

  return (
    <section aria-label={t("collab.section")}>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          {"← " + t("common.back")}
        </button>
        <h2>{t("collab.heading")}</h2>
      </div>

      <p class="settings-hint" aria-live="polite">
        {peerOnline
          ? strategy
            ? t("collab.status.connectedVia", { strategy })
            : t("collab.status.online")
          : t("collab.status.peerOffline")}
      </p>

      <label class="sr-only" for="collab-editor">
        {t("collab.editorLabel")}
      </label>
      <textarea
        id="collab-editor"
        class="collab-editor"
        value={text}
        placeholder={t("collab.placeholder")}
        onInput={(e) => {
          session.setText((e.target as HTMLTextAreaElement).value);
        }}
        aria-label={t("collab.editorLabel")}
        rows={12}
      />

      <p class={overLimit ? "char-count char-count--limit" : "char-count"} aria-live="polite">
        {t("collab.charCount", { count, limit: CHAR_LIMIT })}
        {overLimit && <span> — {t("collab.limitReached")}</span>}
      </p>

      <div class="collab-versions">
        <h3>{t("collab.versions")}</h3>
        <div class="peer-id-input">
          <input
            type="text"
            value={versionLabel.value}
            onInput={(e) => {
              versionLabel.value = (e.target as HTMLInputElement).value;
            }}
            placeholder={t("collab.versionLabelPlaceholder")}
            aria-label={t("collab.versionLabelPlaceholder")}
          />
          <button
            class="start-btn"
            disabled={versionLabel.value.trim().length === 0}
            onClick={() => {
              const label = versionLabel.value.trim();
              if (!label) return;
              session.saveVersion(label);
              versionLabel.value = "";
            }}
            aria-label={t("collab.saveVersion")}
          >
            {t("collab.saveVersion")}
          </button>
        </div>

        {versions.length === 0 ? (
          <p>{t("collab.noVersions")}</p>
        ) : (
          <ul class="version-list">
            {versions.map((v) => (
              <li class="version-list-item" key={v.id}>
                <span class="version-label">{v.label}</span>
                <span class="version-meta">
                  {" "}
                  ({v.siteId.slice(0, 6)} · #{v.lamport})
                </span>
                <button
                  onClick={() => session.restoreVersion(v.id)}
                  aria-label={t("collab.restore")}
                >
                  {t("collab.restore")}
                </button>
                <button
                  onClick={() => {
                    pendingText.value = session.versionText(v.id);
                    navigate("/send/qr");
                  }}
                  aria-label={t("collab.exportQR")}
                >
                  {t("collab.exportQR")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p class="settings-hint">{t("collab.exportNotice")}</p>
      </div>

      <p class="settings-hint">
        {activeCollabRoomId.value
          ? t("collab.persistenceNotice")
          : t("collab.reloadNotice")}
      </p>
    </section>
  );
}
