import { useEffect, useRef, useState } from "preact/hooks";
import { navigate, hashParams } from "../router";
import { pendingFile, pendingText, TEXT_FILENAME } from "../shared-file";
import { t } from "../i18n";
import { formatDuration } from "../send-policy";
import { ContentTypeToggle } from "./ContentTypeToggle";
import { TextInputArea } from "./TextInputArea";
import { SpeedGraph } from "./SpeedGraph";
import { ReceivedResultView, type ReceivedPayload } from "./ReceivedResultView";
import {
  AUDIO_MAX_BYTES,
  DEFAULT_PROFILE_ID,
  estimateNetBytesPerSecond,
  getProfile,
  type AudioProfileId,
} from "@/audio/profiles";
import {
  AudioPayloadTooLargeError,
  AudioReceiveSession,
  AudioSendSession,
  type AudioCodecChoice,
  type ReceiveEvent,
} from "@/audio/session";
import { AudioPlayer, SampleRateTooLowError, type PlayerProgress } from "@/audio/web/playback";
import { MicrophoneError, startCapture, type CaptureHandle } from "@/audio/web/capture";
import { StartGuard, runGuarded } from "@/audio/web/start-guard";
import { encryptPayload } from "@/crypto/encryption";

/** Below this RMS the input is considered too quiet (REQ-AUD-033). */
const TOO_QUIET_DBFS = -50;
const CLIPPING_PEAK = 0.99;
/** How long the "signal detected" badge stays on after a preamble. */
const SIGNAL_HOLD_MS = 4000;

interface Payload {
  readonly data: Uint8Array;
  readonly filename: string;
  readonly isText: boolean;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

const webAudioSupported = () =>
  typeof window !== "undefined" && typeof (window as Window & { AudioContext?: unknown }).AudioContext !== "undefined";

/** Takes the file or text handed over by the chooser / invitation (REQ-AUD-007, 010). */
function preparedPayload(): Payload | null {
  const pending = pendingFile.value;
  const text = pendingText.value;
  if (pending) {
    pendingFile.value = null;
    return {
      data: new Uint8Array(pending.buffer),
      filename: pending.filename,
      isText: pending.isText ?? pending.filename === TEXT_FILENAME,
    };
  }
  if (text) {
    pendingText.value = null;
    return { data: new TextEncoder().encode(text), filename: TEXT_FILENAME, isText: true };
  }
  return null;
}

export function AudioView({ direction }: { direction: "send" | "receive" }) {
  return direction === "send" ? <AudioSender /> : <AudioReceiver />;
}

function AudioHeader({ direction }: { direction: "send" | "receive" }) {
  return (
    <>
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label={t("common.backToHome")}>
          ← {t("common.back")}
        </button>
        <h2>{t(`audio.${direction}Heading`)}</h2>
      </div>
      <p class="settings-hint">{t("audio.experimentalHint")}</p>
    </>
  );
}

// ------------------------------------------------------------------------ sender

function AudioSender() {
  const [initial] = useState(() => preparedPayload());
  // Typed text arrives as message.txt; any other file (even a text file) keeps its name.
  const initialIsMessage = !!initial && initial.isText && initial.filename === TEXT_FILENAME;
  const [contentType, setContentType] = useState<"file" | "text">(initialIsMessage ? "text" : "file");
  const [text, setText] = useState(() => (initialIsMessage ? new TextDecoder().decode(initial!.data) : ""));
  const [filePayload, setFilePayload] = useState<Payload | null>(initial && !initialIsMessage ? initial : null);
  const [profileId, setProfileId] = useState<AudioProfileId>(DEFAULT_PROFILE_ID);
  const [codec, setCodec] = useState<AudioCodecChoice>("auto");
  // Bumped on every file pick, so re-picking a file with the same name and size re-prepares.
  const [fileSeq, setFileSeq] = useState(0);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<AudioSendSession | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<PlayerProgress | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<AudioSendSession | null>(null);
  const playGuard = useRef(new StartGuard()).current;

  const payload: Payload | null = contentType === "text"
    ? (text ? { data: new TextEncoder().encode(text), filename: TEXT_FILENAME, isText: true } : null)
    : filePayload;
  const usePassword = encrypt && password.trim().length > 0;
  const payloadKey = payload
    ? `${contentType}:${fileSeq}:${payload.filename}:${payload.data.length}:${contentType === "text" ? text : ""}:${usePassword ? password : ""}`
    : "";
  const profile = getProfile(profileId);

  const stopPlayback = async () => {
    playGuard.invalidate(); // a Play still starting is cancelled too
    const player = playerRef.current;
    playerRef.current = null;
    setPlaying(false);
    await player?.stop();
  };

  // Prepare (hash, compress, fountain-encode) whenever the content or options change (REQ-AUD-012).
  useEffect(() => {
    let cancelled = false;
    void stopPlayback();
    setProgress(null);
    setError("");
    if (!payload) {
      setSession(null);
      return;
    }
    setPreparing(true);
    const timer = setTimeout(() => {
      // Optional password encryption (AES-256-GCM, as in the other senders); the
      // receiver offers the unlock card. Ciphertext does not compress.
      (usePassword ? encryptPayload(payload.data, password) : Promise.resolve(payload.data))
        .then((bytes) => {
          if (bytes.length > AUDIO_MAX_BYTES) throw new AudioPayloadTooLargeError(bytes.length);
          return AudioSendSession.create(bytes, payload.filename, { isText: payload.isText, profile, codec });
        })
        .then((created) => {
          if (cancelled) {
            created.free();
            return;
          }
          sessionRef.current?.free();
          sessionRef.current = created;
          setSession(created);
        })
        .catch((err) => {
          if (cancelled) return;
          setSession(null);
          setError(err instanceof AudioPayloadTooLargeError
            ? t("audio.tooLarge", { size: err.size, limit: err.limit })
            : err instanceof Error ? err.message : String(err));
        })
        .finally(() => !cancelled && setPreparing(false));
    }, contentType === "text" || usePassword ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payloadKey, profileId, codec]);

  // Leaving the screen stops every source and closes the context (REQ-AUD-020),
  // including a player that is still starting.
  useEffect(() => () => {
    playGuard.dispose();
    void playerRef.current?.stop();
    playerRef.current = null;
    sessionRef.current?.free();
    sessionRef.current = null;
  }, []);

  const play = async () => {
    if (!session || playing) return;
    if (!webAudioSupported()) {
      setError(t("audio.notSupported"));
      return;
    }
    setError("");
    try {
      // Created inside the click handler: autoplay policy needs a user gesture (REQ-AUD-014).
      const player = await runGuarded(playGuard, () => AudioPlayer.start(session, setProgress), (p) => p.stop());
      if (!player) return; // double tap, stopped or left while starting
      playerRef.current = player;
      setPlaying(true);
    } catch (err) {
      setError(err instanceof SampleRateTooLowError
        ? t("audio.ultrasonicWarning")
        : err instanceof Error ? err.message : String(err));
    }
  };

  const info = session?.info;
  const rate = (id: AudioProfileId) => Math.round(estimateNetBytesPerSecond(getProfile(id)));

  return (
    <section aria-label={t("audio.sendSection")}>
      <AudioHeader direction="send" />
      <div class="creator-content">
        <ContentTypeToggle value={contentType} onChange={(type) => setContentType(type)} />
        {contentType === "text" ? (
          <TextInputArea value={text} onChange={setText} disabled={playing} />
        ) : (
          <div class="creator-input">
            <label htmlFor="audio-file">{t("audio.file")}</label>
            <input
              id="audio-file"
              type="file"
              disabled={playing}
              onChange={async (event) => {
                const f = (event.target as HTMLInputElement).files?.[0];
                setFileSeq((n) => n + 1);
                if (!f) {
                  setFilePayload(null);
                  return;
                }
                setFilePayload({
                  data: new Uint8Array(await f.arrayBuffer()),
                  filename: f.name,
                  isText: false,
                });
              }}
            />
            {filePayload && <p class="settings-hint">{filePayload.filename} ({formatBytes(filePayload.data.length)})</p>}
          </div>
        )}

        <div class="audio-controls">
          <label>{t("audio.profile")}
            <select
              value={profileId}
              disabled={playing}
              onChange={(e) => setProfileId((e.target as HTMLSelectElement).value as AudioProfileId)}
            >
              <option value="robust">{t("audio.profileRobust", { rate: rate("robust") })}</option>
              <option value="fast">{t("audio.profileFast", { rate: rate("fast") })}</option>
              {profileId === "ultrasonic" && (
                <option value="ultrasonic">{t("audio.profileUltrasonic", { rate: rate("ultrasonic") })}</option>
              )}
            </select>
          </label>
        </div>
        <details class="audio-advanced">
          <summary>{t("audio.advanced")}</summary>
          <div class="audio-controls">
            <label>
              <input
                type="checkbox"
                checked={profileId === "ultrasonic"}
                disabled={playing}
                onChange={(e) => setProfileId((e.target as HTMLInputElement).checked ? "ultrasonic" : DEFAULT_PROFILE_ID)}
              />
              {t("audio.profileUltrasonic", { rate: rate("ultrasonic") })}
            </label>
            <label>{t("audio.codec")}
              <select value={codec} disabled={playing} onChange={(e) => setCodec((e.target as HTMLSelectElement).value as AudioCodecChoice)}>
                <option value="auto">{t("audio.codecAuto")}</option>
                <option value="lt">{t("audio.codecLt")}</option>
              </select>
            </label>
          </div>
          <p class="settings-hint">{t("audio.ultrasonicWarning")}</p>
        </details>

        <div class="audio-controls">
          <label>
            <input
              type="checkbox"
              checked={encrypt}
              disabled={playing}
              onChange={(e) => setEncrypt((e.target as HTMLInputElement).checked)}
            />
            🔐 {t("encryption.enable")}
          </label>
          {encrypt && (
            <input
              type="password"
              class="creator-input-field"
              aria-label={t("encryption.password")}
              placeholder={t("encryption.passwordPlaceholder")}
              value={password}
              disabled={playing}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          )}
        </div>
        {encrypt && <p class="settings-hint">{t("audio.encryptionHint")}</p>}

        {!payload && <p class="settings-hint">{t("audio.noContent")}</p>}
        {preparing && <p class="settings-hint" role="status">{t("audio.preparing")}</p>}
        {info && (
          <div class="settings-hint" role="status">
            <p>{t("audio.summary", {
              size: info.fileSize,
              compressed: info.compressedSize,
              k: info.k,
              codec: info.codec === "wirehair" ? "Wirehair" : "LT",
            })}</p>
            <p>{t("audio.estimate", { duration: formatDuration(info.estimatedMinSec) })}</p>
          </div>
        )}
        {error && <div class="error-msg" role="alert">{error}</div>}

        <p class="audio-hint">{t("audio.volumeHint")}</p>
        <p class="settings-hint">{t("audio.privacyHint")}</p>

        {!playing ? (
          <button class="start-btn" disabled={!session || preparing} onClick={() => void play()}>
            {t("audio.play")}
          </button>
        ) : (
          <button class="stop-btn" onClick={() => void stopPlayback()}>{t("audio.stop")}</button>
        )}

        {playing && <p role="status">{t("audio.playing")}</p>}
        {progress && info && (
          <div class="transfer-stats" aria-live="polite">
            <div class="stat"><span class="stat-label">{t("audio.packetsSent")}</span><span class="stat-value">{progress.packetsSent}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.symbolsSent")}</span><span class="stat-value">{progress.uniqueSymbols} / {info.k}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.elapsed")}</span><span class="stat-value">{progress.elapsedSec.toFixed(0)} s</span></div>
            <div class="stat"><span class="stat-label">{t("audio.bitrate")}</span><span class="stat-value">{estimateNetBytesPerSecond(profile).toFixed(0)} B/s</span></div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------- receiver

const PROFILE_LABEL_KEYS: Record<AudioProfileId, string> = {
  robust: "audio.profileNameRobust",
  fast: "audio.profileNameFast",
  ultrasonic: "audio.profileNameUltrasonic",
};

interface ReceiverStats {
  profile: AudioProfileId | null;
  accepted: number;
  rejected: number;
  received: number;
  needed: number;
  blockSize: number;
  filename?: string;
  fileSize?: number;
}

const emptyStats: ReceiverStats = { profile: null, accepted: 0, rejected: 0, received: 0, needed: 0, blockSize: 0 };

function AudioReceiver() {
  const captureRef = useRef<CaptureHandle | null>(null);
  const sessionRef = useRef<AudioReceiveSession | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const listenGuard = useRef(new StartGuard()).current;
  const startRef = useRef(0);
  const lastSyncRef = useRef(0);
  const [listening, setListening] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState<{ rmsDbfs: number; peak: number } | null>(null);
  const [stats, setStats] = useState<ReceiverStats>(emptyStats);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<ReceivedPayload | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const speedHistory = useRef<number[]>([]);

  const stopListening = async () => {
    listenGuard.invalidate(); // a start still waiting for the microphone is cancelled too
    const capture = captureRef.current;
    captureRef.current = null;
    setListening(false);
    setSuspended(false);
    await capture?.stop();
  };

  const handleEvents = (events: ReceiveEvent[]) => {
    for (const ev of events) {
      if (ev.kind === "level") setLevel({ rmsDbfs: ev.rmsDbfs, peak: ev.peak });
      else if (ev.kind === "sync") lastSyncRef.current = Date.now();
      else if (ev.kind === "progress") {
        setStats({
          profile: ev.profile,
          accepted: ev.accepted,
          rejected: ev.rejected,
          received: ev.received,
          needed: ev.needed,
          blockSize: ev.blockSize,
          filename: ev.filename,
          fileSize: ev.fileSize,
        });
      } else if (ev.kind === "error") {
        setError(ev.code === "wirehair_unavailable" ? t("audio.wirehairUnavailable") : t("audio.decodeFailed", { message: ev.message }));
        void stopListening();
      } else if (ev.kind === "complete") {
        setDurationSec((Date.now() - startRef.current) / 1000);
        setResult({ file: ev.file, filename: ev.filename, isText: ev.isText, verified: ev.verified });
        // Stop the microphone and close the AudioContext (REQ-AUD-039).
        void stopListening();
      }
    }
  };

  const start = async () => {
    if (listening) return;
    if (!webAudioSupported()) {
      setError(t("audio.notSupported"));
      return;
    }
    setError("");
    setResult(null);
    setStats(emptyStats);
    setLevel(null);
    speedHistory.current = [];
    lastSyncRef.current = 0;
    try {
      let session: AudioReceiveSession | null = null;
      chainRef.current = Promise.resolve();
      // Guarded: a double tap (or autostart + tap) starts one capture only, and a capture
      // that opens after Stop or after leaving the screen is closed at once.
      const capture = await runGuarded(listenGuard, () => startCapture((chunk) => {
        if (!session || session.isDone) return;
        const s = session;
        chainRef.current = chainRef.current.then(async () => handleEvents(await s.push(chunk))).catch((err) => {
          setError(t("audio.decodeFailed", { message: err instanceof Error ? err.message : String(err) }));
        });
      }), (c) => c.stop());
      if (!capture) return;
      sessionRef.current?.free();
      session = new AudioReceiveSession(capture.sampleRate);
      sessionRef.current = session;
      captureRef.current = capture;
      startRef.current = Date.now();
      setListening(true);
      if (capture.suspended && !(await capture.resume())) setSuspended(true);
    } catch (err) {
      if (err instanceof MicrophoneError) setError(err.code === "denied" ? t("audio.micDenied") : t("audio.micUnavailable"));
      else setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Invitation links open with autostart=1 (REQ-AUD-032).
  useEffect(() => {
    if (hashParams.value.get("autostart") === "1") void start();
    return () => {
      listenGuard.dispose();
      void captureRef.current?.stop();
      captureRef.current = null;
      sessionRef.current?.free();
      sessionRef.current = null;
    };
  }, []);

  // One-second ticker: elapsed time, speed history, signal badge timeout.
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [listening]);

  const elapsedSec = listening ? Math.max(0, (now - startRef.current) / 1000) : durationSec;
  const bytesHeard = stats.received * stats.blockSize;
  const rate = elapsedSec > 0 ? bytesHeard / elapsedSec : 0;
  useEffect(() => {
    if (listening && elapsedSec > 0) speedHistory.current = [...speedHistory.current.slice(-60), rate];
  }, [now]);
  const signal = listening && now - lastSyncRef.current < SIGNAL_HOLD_MS && lastSyncRef.current > 0;
  const progressPct = stats.needed > 0 ? Math.min(100, (stats.received / stats.needed) * 100) : 0;

  return (
    <section aria-label={t("audio.receiveSection")}>
      <AudioHeader direction="receive" />
      <div class="audio-controls">
        {!listening ? (
          !result && <button class="start-btn" onClick={() => void start()}>{t("audio.startListening")}</button>
        ) : (
          <button class="stop-btn" onClick={() => void stopListening()}>{t("common.stop")}</button>
        )}
      </div>
      {suspended && (
        <button
          class="start-btn audio-tap-start"
          onClick={async () => {
            if (await captureRef.current?.resume()) setSuspended(false);
          }}
        >
          {t("audio.tapToStart")}
        </button>
      )}
      {error && <div class="error-msg" role="alert">{error}</div>}

      {listening && !result && (
        <>
          <div class="audio-level">
            <label>{t("audio.level")}
              <meter
                min={-60}
                max={0}
                low={TOO_QUIET_DBFS}
                high={-6}
                optimum={-20}
                value={level ? Math.max(-60, level.rmsDbfs) : -60}
                aria-label={t("audio.level")}
              />
            </label>
            <span class="stat-value">{level ? `${level.rmsDbfs.toFixed(0)} dBFS` : "—"}</span>
            <span class={`audio-signal ${signal ? "detected" : ""}`} role="status">
              {signal ? t("audio.signalDetected") : t("audio.waitingSignal")}
            </span>
          </div>
          {level && level.rmsDbfs < TOO_QUIET_DBFS && <p class="settings-hint">{t("audio.tooQuiet")}</p>}
          {level && level.peak >= CLIPPING_PEAK && <p class="error-msg">{t("audio.clipping")}</p>}

          <div class="progress-container">
            <div class="progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <div class="transfer-stats" aria-live="polite">
            <div class="stat"><span class="stat-label">{t("audio.detectedProfile")}</span><span class="stat-value">{stats.profile ? t(PROFILE_LABEL_KEYS[stats.profile]) : "—"}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.packetsAccepted")}</span><span class="stat-value">{stats.accepted}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.packetsRejected")}</span><span class="stat-value">{stats.rejected}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.uniqueSymbols")}</span><span class="stat-value">{stats.received} / {stats.needed || "?"}</span></div>
            <div class="stat"><span class="stat-label">{t("audio.elapsed")}</span><span class="stat-value">{elapsedSec.toFixed(0)} s</span></div>
            <div class="stat"><span class="stat-label">{t("audio.speed")}</span><span class="stat-value">{rate.toFixed(1)} B/s</span></div>
          </div>
          {speedHistory.current.length > 1 && <SpeedGraph history={speedHistory.current} maxSpeed={64} />}
        </>
      )}

      {result && (
        <ReceivedResultView
          payload={result}
          message={t("audio.complete", { filename: result.filename })}
          summary={{
            bytes: result.file.length,
            durationSec,
            speedBytesPerSec: durationSec > 0 ? result.file.length / durationSec : 0,
            detail: `${stats.accepted} ${t("audio.packets")}`,
          }}
        />
      )}
    </section>
  );
}
