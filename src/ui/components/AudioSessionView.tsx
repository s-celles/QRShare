import { useEffect, useRef, useState } from "preact/hooks";
import { navigate } from "../router";
import { t } from "../i18n";
import { AudioRoom, type MemberView, type RoomEvent } from "@/audio/link/room";
import { MAX_CHAT_BYTES } from "@/audio/link/protocol";
import { AudioLinkRuntime, createOutputContext } from "@/audio/web/link-runtime";
import { MicrophoneError } from "@/audio/web/capture";
import { StartGuard, runGuarded } from "@/audio/web/start-guard";
import { AUDIO_PROFILES, profileIndex, type AudioProfileId } from "@/audio/profiles";
import { createIdentity } from "@/collab/core/identity";
import { ReceivedResultView, type ReceivedPayload } from "./ReceivedResultView";

type Phase = "start" | "searching" | "joining" | "room";

type Entry =
  | { kind: "message"; key: string; mine: boolean; name: string; color: string; text: string; rseq?: number; receivedBy?: number; total?: number; status?: "pending" | "delivered" | "failed" }
  | { kind: "system"; key: string; text: string }
  | { kind: "file"; key: string; name: string; payload: ReceivedPayload };

interface FoundRoom {
  roomId: string;
  hostName: string;
  profileIndex: number;
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length;
const PROFILE_KEYS: Record<AudioProfileId, string> = {
  robust: "audio.profileNameRobust",
  fast: "audio.profileNameFast",
  ultrasonic: "audio.profileNameUltrasonic",
};

export function AudioSessionView() {
  const [phase, setPhase] = useState<Phase>("start");
  const [name, setName] = useState(() => createIdentity().name);
  const [profileId, setProfileId] = useState<AudioProfileId>("fast");
  const [found, setFound] = useState<FoundRoom[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [code, setCode] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [soundSuspended, setSoundSuspended] = useState(false);
  const [joinAttempts, setJoinAttempts] = useState(0);
  const [level, setLevel] = useState(-120);
  const [fileState, setFileState] = useState<{ packets: number; done: number; total: number; active: boolean } | null>(null);
  const roomRef = useRef<AudioRoom | null>(null);
  const runtimeRef = useRef<AudioLinkRuntime | null>(null);
  const guard = useRef(new StartGuard()).current;
  const seq = useRef(0);
  const nextKey = () => String(++seq.current);

  const addEntry = (e: Entry) => setEntries((list) => [...list, e]);

  const onRoomEvents = (events: RoomEvent[]) => {
    const room = roomRef.current;
    for (const ev of events) {
      switch (ev.kind) {
        case "room_found":
          setFound((list) => [...list.filter((r) => r.roomId !== ev.roomId), { roomId: ev.roomId, hostName: ev.hostName, profileIndex: ev.profileIndex }]);
          break;
        case "joined":
          setPhase("room");
          addEntry({ kind: "system", key: nextKey(), text: t("audioSession.joined") });
          break;
        case "join_failed":
          setPhase("searching");
          setError(t("audioSession.joinFailed"));
          break;
        case "security_warning":
          setWarning(true);
          setPhase("searching");
          break;
        case "members":
          setMembers(ev.members);
          setCode(ev.code);
          break;
        case "message": {
          const m = room?.memberViews().find((x) => x.id === ev.from);
          addEntry({ kind: "message", key: nextKey(), mine: false, name: ev.name || m?.name || "?", color: m?.color ?? "#555", text: ev.text });
          break;
        }
        case "delivery":
          setEntries((list) => list.map((e) => (e.kind === "message" && e.mine && e.rseq === ev.rseq ? { ...e, receivedBy: ev.receivedBy, total: ev.total, status: ev.status } : e)));
          break;
        case "left":
          addEntry({ kind: "system", key: nextKey(), text: t("audioSession.memberLeft", { name: ev.name || "?" }) });
          break;
        case "file_done":
          break;
      }
    }
  };

  const start = async (role: "host" | "guest") => {
    setError("");
    setWarning(false);
    // Created first, synchronously inside the click: after the microphone prompt the
    // browser would no longer count it as a user gesture and keep the sound muted.
    let out: AudioContext | null = null;
    try {
      out = createOutputContext();
    } catch {
      setError(t("audio.notSupported"));
      return;
    }
    try {
      const room = role === "host"
        ? await AudioRoom.host({ name, profileIndex: profileIndex(profileId) })
        : await AudioRoom.guest({ name });
      const runtime = await runGuarded(guard, () => AudioLinkRuntime.start(room, {
        onRoomEvents,
        onLevel: (db) => setLevel(db),
        onTransmitting: setTransmitting,
        onAudioState: setSoundSuspended,
        onFileSendProgress: (s) => {
          setFileState(s.active ? s : null);
          if (!s.active && s.total > 0 && s.done >= s.total) addEntry({ kind: "system", key: nextKey(), text: t("audioSession.fileDelivered") });
        },
        onFileReceived: (f) => addEntry({
          kind: "file",
          key: nextKey(),
          name: f.filename,
          payload: { file: f.file, filename: f.filename, isText: f.isText, verified: f.verified },
        }),
        onError: (m) => setError(m),
      }, { out }), (r) => r.stop());
      if (!runtime) {
        await out.close().catch(() => {});
        return;
      }
      roomRef.current = room;
      runtimeRef.current = runtime;
      if (role === "host") {
        setMembers(room.memberViews());
        setCode(room.verificationCode);
        setPhase("room");
      } else {
        setPhase("searching");
      }
    } catch (err) {
      await out.close().catch(() => {});
      if (err instanceof MicrophoneError) setError(err.code === "denied" ? t("audio.micDenied") : t("audio.micUnavailable"));
      else setError(err instanceof Error ? err.message : String(err));
    }
  };

  const leave = async () => {
    guard.invalidate();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    roomRef.current = null;
    await runtime?.stop();
    setPhase("start");
    setFound([]);
    setMembers([]);
    setEntries([]);
    setCode("");
    setFileState(null);
  };

  useEffect(() => {
    if (phase !== "joining") return;
    const id = setInterval(() => setJoinAttempts(roomRef.current?.joinAttempts ?? 0), 500);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => {
    guard.dispose();
    void runtimeRef.current?.stop();
  }, []);

  const send = () => {
    const room = roomRef.current;
    const text = draft.trim();
    if (!room || !text || utf8Len(text) > MAX_CHAT_BYTES) return;
    void runtimeRef.current?.resume(); // a click: let the browser start the sound if needed
    const rseq = room.sendChat(text);
    const me = room.memberViews().find((m) => m.self);
    addEntry({ kind: "message", key: nextKey(), mine: true, name: room.name, color: me?.color ?? "#555", text, rseq, receivedBy: 0, total: members.length - 1, status: "pending" });
    setDraft("");
  };

  const sendFile = async (file: File | null) => {
    if (!file || !runtimeRef.current) return;
    try {
      await runtimeRef.current.sendFile(new Uint8Array(await file.arrayBuffer()), file.name, file.type.startsWith("text/"));
      addEntry({ kind: "system", key: nextKey(), text: t("audioSession.fileSending", { name: file.name }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const draftBytes = utf8Len(draft);

  return (
    <section aria-label={t("audioSession.section")}>
      <div class="view-header">
        <button onClick={() => { void leave(); navigate("/"); }} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t("audioSession.heading")}</h2>
      </div>
      <p class="settings-hint">{t("audioSession.hint")}</p>
      {error && <div class="error-msg" role="alert">{error}</div>}
      {soundSuspended && phase !== "start" && (
        <button class="start-btn audio-tap-start" onClick={() => void runtimeRef.current?.resume()}>
          🔊 {t("audioSession.enableSound")}
        </button>
      )}
      {warning && <div class="error-msg" role="alert">{t("audioSession.securityWarning")}</div>}

      {phase === "start" && (
        <div class="creator-content">
          <label class="audio-controls">{t("audioSession.yourName")}
            <input class="creator-input-field" value={name} maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <div class="mode-grid">
            <div class="mode-btn mode-btn--send">
              <span class="mode-label">{t("audioSession.create")}</span>
              <span class="mode-desc">{t("audioSession.createDesc")}</span>
              <label>{t("audio.profile")}
                <select value={profileId} onChange={(e) => setProfileId((e.target as HTMLSelectElement).value as AudioProfileId)}>
                  {AUDIO_PROFILES.map((p) => <option value={p.id}>{t(PROFILE_KEYS[p.id])}</option>)}
                </select>
              </label>
              <button class="start-btn" onClick={() => void start("host")}>{t("audioSession.createButton")}</button>
            </div>
            <div class="mode-btn mode-btn--receive">
              <span class="mode-label">{t("audioSession.join")}</span>
              <span class="mode-desc">{t("audioSession.joinDesc")}</span>
              <button class="start-btn" onClick={() => void start("guest")}>{t("audioSession.joinButton")}</button>
            </div>
          </div>
          <p class="audio-hint">{t("audio.volumeHint")}</p>
        </div>
      )}

      {phase === "searching" && (
        <div class="creator-content">
          <p role="status">{t("audioSession.searching")}</p>
          <meter min={-60} max={0} value={Math.max(-60, level)} aria-label={t("audio.level")} />
          {found.length === 0 ? null : (
            <ul class="audio-session-rooms">
              {found.map((r) => (
                <li key={r.roomId}>
                  <span>{t("audioSession.roomOf", { name: r.hostName })}</span>
                  <button class="start-btn" onClick={() => { void runtimeRef.current?.resume(); roomRef.current?.join(r.roomId); setPhase("joining"); }}>
                    {t("audioSession.joinButton")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button class="stop-btn" onClick={() => void leave()}>{t("common.cancel")}</button>
        </div>
      )}

      {phase === "joining" && (
        <div class="creator-content">
          <p role="status">{t("audioSession.joining")}</p>
          <p class="settings-hint">{t("audioSession.joinAttempts", { n: joinAttempts })}</p>
          <button class="stop-btn" onClick={() => void leave()}>{t("common.cancel")}</button>
        </div>
      )}

      {phase === "room" && (
        <div class="audio-session">
          <div class="audio-session-code" aria-live="polite">
            <span class="stat-label">{t("audioSession.code")}</span>
            <span class="audio-session-code-value">{code}</span>
            <span class="settings-hint">{t("audioSession.codeHint")}</span>
          </div>
          <ul class="audio-session-members" aria-label={t("audioSession.members")}>
            {members.map((m) => (
              <li key={m.id} style={{ borderColor: m.color, color: m.color }} class={m.away ? "away" : ""}>
                {m.name || "…"}{m.self ? ` (${t("audioSession.you")})` : ""}{m.host ? " ★" : ""}{m.away ? ` · ${t("audioSession.away")}` : ""}
              </li>
            ))}
          </ul>
          {members.length < 2 && <p class="settings-hint" role="status">{t("audioSession.waiting")}</p>}
          <span class={`audio-signal ${transmitting ? "detected" : ""}`}>{transmitting ? t("audioSession.transmitting") : t("audioSession.listening")}</span>

          <ol class="audio-session-log" aria-live="polite">
            {entries.map((e) =>
              e.kind === "system" ? (
                <li key={e.key} class="system">{e.text}</li>
              ) : e.kind === "file" ? (
                <li key={e.key} class="file">
                  <ReceivedResultView payload={e.payload} summary={{ bytes: e.payload.file.length, durationSec: 0, speedBytesPerSec: 0, detail: t("audioSession.sessionFile") }} message={t("audio.complete", { filename: e.name })} />
                </li>
              ) : (
                <li key={e.key} class={e.mine ? "mine" : ""}>
                  <strong style={{ color: e.color }}>{e.name}</strong> {e.text}
                  {e.mine && (
                    <span class="delivery">
                      {e.status === "failed" ? ` ✗ ${t("audioSession.notDelivered")}` : e.status === "delivered" ? " ✓✓" : ` ✓ ${e.receivedBy ?? 0}/${e.total ?? 0}`}
                    </span>
                  )}
                </li>
              ),
            )}
          </ol>

          <form class="audio-session-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input
              class="creator-input-field"
              value={draft}
              placeholder={members.length < 2 ? t("audioSession.waiting") : t("audioSession.placeholder")}
              disabled={members.length < 2}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              aria-label={t("audioSession.placeholder")}
            />
            <span class={`settings-hint ${draftBytes > MAX_CHAT_BYTES ? "error-msg" : ""}`}>{draftBytes}/{MAX_CHAT_BYTES}</span>
            <button type="submit" class="start-btn" disabled={members.length < 2 || !draft.trim() || draftBytes > MAX_CHAT_BYTES}>
              {t("audioSession.send")}
            </button>
          </form>

          <div class="audio-controls">
            <label>{t("audioSession.sendFile")}
              <input type="file" disabled={members.length < 2 || !!fileState?.active} onChange={(e) => void sendFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
            </label>
            {fileState?.active && (
              <>
                <span class="settings-hint">{t("audioSession.fileProgress", { packets: fileState.packets, done: fileState.done, total: fileState.total })}</span>
                <button class="stop-btn" onClick={() => runtimeRef.current?.cancelFile()}>{t("common.cancel")}</button>
              </>
            )}
          </div>
          <button class="stop-btn" onClick={() => void leave()}>{t("audioSession.leave")}</button>
        </div>
      )}
    </section>
  );
}

