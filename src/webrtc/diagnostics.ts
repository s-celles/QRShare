import type { IceServerConfig } from "./types";

/**
 * Honest classification of WebRTC connection failures.
 *
 * The constraint that shapes this whole module: trystero exposes no peer object
 * until the DataChannel is open (`room.js:285-311` ← `strategy.js:54-71` ←
 * `peer.js:23`). `onPeerJoin` therefore *implies* ICE already succeeded, and a
 * failing ICE attempt is invisible — its candidate connections live in the
 * module-private `offerPool`. So "the relay is dead", "the receiver went away" and
 * "ICE could not find a path" arrive as one indistinguishable non-event.
 *
 * We therefore separate the **observable outcome** from the **inferred cause**, and
 * attach a confidence. The only high-confidence inference available is about the
 * *local* side, drawn from a local ICE probe over the very same server list a real
 * connection would use. Anything about the remote peer stays low confidence.
 *
 * See `.claude/specs/webrtc-reliability.md`.
 */

/** What we actually observed. */
export type FailureOutcome =
  | "peer-never-joined"
  | "peer-left"
  | "no-strategy-initialized"
  | "wrong-room-id";

/** What we tell the user, as a stable code the UI translates. */
export type DiagnosisCode =
  | "relay-likely-required"
  | "turn-not-working"
  | "peer-unreachable"
  | "peer-dropped"
  | "peer-left-deliberately"
  | "no-strategy-initialized"
  | "wrong-room-id";

export type CandidateType = "host" | "srflx" | "prflx" | "relay";

export interface IceProbeResult {
  candidateTypes: CandidateType[];
  /** A server-reflexive candidate was gathered — STUN answered. */
  stunReachable: boolean;
  /** A turn:/turns: URL is present in the configuration. */
  turnConfigured: boolean;
  /** A relay candidate was gathered — the TURN server actually works. */
  turnReachable: boolean;
  timedOut: boolean;
}

export interface ConnectionDiagnosis {
  code: DiagnosisCode;
  confidence: "high" | "low";
  probe?: IceProbeResult;
}

export interface ClassifyInput {
  outcome: FailureOutcome;
  probe?: IceProbeResult;
  lastPeerConnectionState?: RTCPeerConnectionState;
  lastIceConnectionState?: RTCIceConnectionState;
}

/** Pure. [REQ-RELY-020..023] */
export function classifyFailure(input: ClassifyInput): ConnectionDiagnosis {
  const { outcome, probe } = input;

  if (outcome === "no-strategy-initialized" || outcome === "wrong-room-id") {
    return { code: outcome, confidence: "high" };
  }

  if (outcome === "peer-left") {
    // By the time onPeerLeave fires trystero has already closed the connection
    // (`room.js:61-72`), so this reads the last state sampled while it was alive.
    const last = input.lastPeerConnectionState ?? input.lastIceConnectionState;
    if (last === "disconnected" || last === "failed") {
      return { code: "peer-dropped", confidence: "high", probe };
    }
    // Either a clean leave, or nothing was sampled. Do not guess a drop.
    return { code: "peer-left-deliberately", confidence: "low", probe };
  }

  // peer-never-joined — ambiguous by construction [REQ-RELY-021].
  if (!probe) {
    return { code: "peer-unreachable", confidence: "low" };
  }
  // A probe that timed out proves nothing about what it did *not* see: the relay
  // candidate may simply not have arrived yet. Absence of evidence is not evidence
  // of absence, so every conclusion drawn from a missing candidate is downgraded.
  // (Candidates it *did* see remain valid — a timeout does not unsee them.)
  const confidence = probe.timedOut ? "low" : "high";

  if (probe.turnConfigured && !probe.turnReachable) {
    // The user configured a relay and it produced no relay candidate. Directly
    // fixable (URL / credentials / port), so it outranks the missing-srflx signal
    // even when both are true.
    return { code: "turn-not-working", confidence, probe };
  }
  if (!probe.stunReachable && !probe.turnConfigured) {
    // Only host candidates and no relay configured: this network cannot do direct
    // P2P and nothing is set up to relay it.
    return { code: "relay-likely-required", confidence, probe };
  }
  // Local ICE looks healthy, so the failure is most likely the remote peer or
  // signaling — which we cannot see. Low confidence, deliberately.
  return { code: "peer-unreachable", confidence: "low", probe };
}

// ---------------------------------------------------------------------------
// ICE probe
// ---------------------------------------------------------------------------

const urlsOf = (s: IceServerConfig): string[] =>
  Array.isArray(s.urls) ? s.urls : [s.urls];

const isTurnUrl = (u: string) => u.startsWith("turn:") || u.startsWith("turns:");

/** Does this configuration name a TURN server at all? */
export function hasTurnServer(iceServers: IceServerConfig[]): boolean {
  return iceServers.some((s) => urlsOf(s).some(isTurnUrl));
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Injectable for tests. [REQ-RELY-046] */
  PeerConnection?: typeof RTCPeerConnection;
}

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Gather ICE candidates against a given server list and report what came back.
 *
 * Standard Trickle-ICE shape, W3C APIs only — no trystero internals, so it stays
 * valid across upgrades [REQ-RELY-042]. Callers must pass the list a real
 * connection would use, i.e. `buildJoinConfig(...).rtcConfig?.iceServers`
 * [REQ-RELY-043], or the conclusions do not transfer.
 */
export function probeIce(
  iceServers: IceServerConfig[],
  opts: ProbeOptions = {},
): Promise<IceProbeResult> {
  const Ctor = opts.PeerConnection ?? RTCPeerConnection;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const turnConfigured = hasTurnServer(iceServers);
  const types = new Set<CandidateType>();

  const result = (timedOut: boolean): IceProbeResult => ({
    candidateTypes: [...types],
    stunReachable: types.has("srflx"),
    turnConfigured,
    turnReachable: types.has("relay"),
    timedOut,
  });

  const pc = new Ctor({ iceServers: iceServers as RTCIceServer[] });

  return new Promise<IceProbeResult>((resolve) => {
    let done = false;
    const finish = (timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Never leave a probe running [REQ-RELY-045].
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      resolve(result(timedOut));
    };

    const timer = setTimeout(() => finish(true), timeoutMs);

    pc.onicecandidate = (e) => {
      if (e.candidate === null) {
        finish(false); // end of candidates
        return;
      }
      const t = e.candidate.type as CandidateType | null;
      if (t) types.add(t);
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish(false);
    };

    // Candidates are only gathered once there is something to gather for.
    pc.createDataChannel("probe");
    pc.setLocalDescription().catch(() => finish(false));
  });
}
