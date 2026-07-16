import { describe, expect, it } from "bun:test";
import { WebRTCService, resolvePeerLeave } from "@/webrtc/service";
import type { ConnectionState } from "@/webrtc/types";

describe("resolvePeerLeave policy", () => {
  it("keeps an editing session alive (peer offline, no state change)", () => {
    const r = resolvePeerLeave("editing");
    expect(r.nextState).toBeNull();
    expect(r.peerOffline).toBe(true);
  });

  it("ignores peer-leave after a completed transfer", () => {
    const r = resolvePeerLeave("complete");
    expect(r.nextState).toBeNull();
    expect(r.peerOffline).toBe(false);
  });

  it("treats peer-leave during other states as an error", () => {
    for (const s of ["confirming", "transferring", "connecting"] as ConnectionState[]) {
      expect(resolvePeerLeave(s).nextState).toBe("error");
    }
  });
});

describe("WebRTCService editing transitions", () => {
  it("starts idle and has no room to hand off", () => {
    const svc = new WebRTCService();
    expect(svc.state.value).toBe("idle");
    expect(svc.getRoom()).toBeNull();
    expect(svc.peerOnline.value).toBe(false);
  });

  it("enterEditing transitions to the editing state", () => {
    const svc = new WebRTCService();
    svc.enterEditing();
    expect(svc.state.value).toBe("editing");
  });

  it("startCollab transitions to editing even without a peer-signal wired", () => {
    const svc = new WebRTCService();
    svc.startCollab();
    expect(svc.state.value).toBe("editing");
  });
});
