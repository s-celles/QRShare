import { describe, expect, it } from "bun:test";
import {
  classifyFailure,
  probeIce,
  type IceProbeResult,
} from "@/webrtc/diagnostics";
import type { IceServerConfig } from "@/webrtc/types";

const probe = (over: Partial<IceProbeResult> = {}): IceProbeResult => ({
  candidateTypes: ["host"],
  stunReachable: false,
  turnConfigured: false,
  turnReachable: false,
  timedOut: false,
  ...over,
});

describe("classifyFailure — peer-never-joined [REQ-RELY-022]", () => {
  it("no srflx and no TURN configured -> relay likely required (high)", () => {
    const d = classifyFailure({
      outcome: "peer-never-joined",
      probe: probe({ stunReachable: false, turnConfigured: false }),
    });
    expect(d.code).toBe("relay-likely-required");
    expect(d.confidence).toBe("high");
  });

  it("TURN configured but no relay candidate -> turn not working (high)", () => {
    const d = classifyFailure({
      outcome: "peer-never-joined",
      probe: probe({ stunReachable: true, turnConfigured: true, turnReachable: false }),
    });
    expect(d.code).toBe("turn-not-working");
    expect(d.confidence).toBe("high");
  });

  it("a broken TURN outranks the missing-srflx signal", () => {
    // Both "no stun" and "turn broken" are true. The actionable one wins.
    const d = classifyFailure({
      outcome: "peer-never-joined",
      probe: probe({ stunReachable: false, turnConfigured: true, turnReachable: false }),
    });
    expect(d.code).toBe("turn-not-working");
  });

  it("healthy local ICE -> peer unreachable, and only LOW confidence", () => {
    const d = classifyFailure({
      outcome: "peer-never-joined",
      probe: probe({ candidateTypes: ["host", "srflx"], stunReachable: true }),
    });
    expect(d.code).toBe("peer-unreachable");
    // We cannot see the remote side; never claim high confidence about it.
    expect(d.confidence).toBe("low");
  });

  it("healthy STUN and a working TURN -> peer unreachable (low)", () => {
    const d = classifyFailure({
      outcome: "peer-never-joined",
      probe: probe({
        candidateTypes: ["host", "srflx", "relay"],
        stunReachable: true,
        turnConfigured: true,
        turnReachable: true,
      }),
    });
    expect(d.code).toBe("peer-unreachable");
    expect(d.confidence).toBe("low");
  });

  it("without a probe it stays ambiguous, never a confident claim [REQ-RELY-021]", () => {
    const d = classifyFailure({ outcome: "peer-never-joined" });
    expect(d.code).toBe("peer-unreachable");
    expect(d.confidence).toBe("low");
  });

  it("carries the probe through for the UI details block", () => {
    const p = probe({ stunReachable: true });
    expect(classifyFailure({ outcome: "peer-never-joined", probe: p }).probe).toBe(p);
  });
});

describe("classifyFailure — peer-left [REQ-RELY-023]", () => {
  it("last connection state failed -> peer dropped (high)", () => {
    const d = classifyFailure({
      outcome: "peer-left",
      lastPeerConnectionState: "failed",
    });
    expect(d.code).toBe("peer-dropped");
    expect(d.confidence).toBe("high");
  });

  it("last connection state disconnected -> peer dropped (high)", () => {
    const d = classifyFailure({
      outcome: "peer-left",
      lastPeerConnectionState: "disconnected",
    });
    expect(d.code).toBe("peer-dropped");
  });

  it("last connection state connected -> deliberate leave (low)", () => {
    const d = classifyFailure({
      outcome: "peer-left",
      lastPeerConnectionState: "connected",
    });
    expect(d.code).toBe("peer-left-deliberately");
    expect(d.confidence).toBe("low");
  });

  it("falls back to the ICE connection state when no peer state was sampled", () => {
    expect(
      classifyFailure({ outcome: "peer-left", lastIceConnectionState: "failed" }).code,
    ).toBe("peer-dropped");
    expect(
      classifyFailure({ outcome: "peer-left", lastIceConnectionState: "completed" }).code,
    ).toBe("peer-left-deliberately");
  });

  it("with nothing sampled it does not guess a drop", () => {
    const d = classifyFailure({ outcome: "peer-left" });
    expect(d.code).toBe("peer-left-deliberately");
    expect(d.confidence).toBe("low");
  });
});

describe("classifyFailure — terminal outcomes", () => {
  it("no strategy initialized", () => {
    const d = classifyFailure({ outcome: "no-strategy-initialized" });
    expect(d.code).toBe("no-strategy-initialized");
    expect(d.confidence).toBe("high");
  });

  it("wrong room id", () => {
    const d = classifyFailure({ outcome: "wrong-room-id" });
    expect(d.code).toBe("wrong-room-id");
    expect(d.confidence).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// probeIce — driven entirely by a fake RTCPeerConnection; no network.
// ---------------------------------------------------------------------------

type CandidateType = "host" | "srflx" | "prflx" | "relay";

class FakePeerConnection {
  static last: FakePeerConnection | null = null;
  onicecandidate: ((e: { candidate: { type: CandidateType } | null }) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  iceGatheringState: RTCIceGatheringState = "new";
  closed = false;
  channels: string[] = [];
  localDescriptionSet = false;

  constructor(readonly config: { iceServers?: unknown[] }) {
    FakePeerConnection.last = this;
  }
  createDataChannel(label: string) {
    this.channels.push(label);
    return {};
  }
  async setLocalDescription() {
    this.localDescriptionSet = true;
  }
  close() {
    this.closed = true;
  }

  /** Test helpers. */
  emit(type: CandidateType) {
    this.onicecandidate?.({ candidate: { type } });
  }
  complete() {
    this.iceGatheringState = "complete";
    this.onicegatheringstatechange?.();
  }
  endOfCandidates() {
    this.onicecandidate?.({ candidate: null });
  }
}

const asCtor = (c: typeof FakePeerConnection) => c as unknown as typeof RTCPeerConnection;

/** Let the probe's microtasks (setLocalDescription) settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

const STUN: IceServerConfig[] = [{ urls: "stun:stun.example.com:19302" }];
const TURN: IceServerConfig[] = [
  { urls: "stun:stun.example.com:19302" },
  { urls: "turn:turn.example.com:3478", username: "u", credential: "c" },
];

describe("probeIce [REQ-RELY-040..046]", () => {
  it("collects candidate types and derives stunReachable", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    pc.emit("host");
    pc.emit("srflx");
    pc.complete();

    const r = await p;
    expect(r.candidateTypes).toContain("host");
    expect(r.candidateTypes).toContain("srflx");
    expect(r.stunReachable).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it("derives turnConfigured from the input list, not from candidates", async () => {
    const p = probeIce(TURN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    pc.emit("host");
    pc.complete();

    const r = await p;
    expect(r.turnConfigured).toBe(true);
    expect(r.turnReachable).toBe(false); // no relay candidate gathered
  });

  it("turnReachable only when a relay candidate is gathered", async () => {
    const p = probeIce(TURN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    pc.emit("relay");
    pc.complete();

    const r = await p;
    expect(r.turnReachable).toBe(true);
  });

  it("no TURN in the list means turnConfigured is false", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    FakePeerConnection.last!.complete();
    expect((await p).turnConfigured).toBe(false);
  });

  it("recognises turns: as TURN too", async () => {
    const p = probeIce([{ urls: "turns:turn.example.com:5349" }], {
      PeerConnection: asCtor(FakePeerConnection),
    });
    await tick();
    FakePeerConnection.last!.complete();
    expect((await p).turnConfigured).toBe(true);
  });

  it("resolves on end-of-candidates (null candidate)", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    pc.emit("host");
    pc.endOfCandidates();
    expect((await p).candidateTypes).toEqual(["host"]);
  });

  it("times out and reports it rather than hanging", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection), timeoutMs: 5 });
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(r.stunReachable).toBe(false);
  });

  it("opens a data channel and sets a local description (candidates need both)", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    expect(pc.channels).toEqual(["probe"]);
    expect(pc.localDescriptionSet).toBe(true);
    pc.complete();
    await p;
  });

  it("always closes the peer connection [REQ-RELY-045]", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection) });
    await tick();
    const pc = FakePeerConnection.last!;
    pc.complete();
    await p;
    expect(pc.closed).toBe(true);
  });

  it("closes the peer connection on timeout too", async () => {
    const p = probeIce(STUN, { PeerConnection: asCtor(FakePeerConnection), timeoutMs: 5 });
    await p;
    expect(FakePeerConnection.last!.closed).toBe(true);
  });

  it("passes the ICE server list straight to the peer connection [REQ-RELY-043]", async () => {
    const p = probeIce(TURN, { PeerConnection: asCtor(FakePeerConnection), timeoutMs: 5 });
    await p;
    expect(FakePeerConnection.last!.config.iceServers).toEqual(TURN);
  });
});
