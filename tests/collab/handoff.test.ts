import { describe, expect, it, beforeEach } from "bun:test";
import {
  activeCollabService,
  activeCollabRoomId,
  leaveCollab,
  shouldDisconnectOnUnmount,
} from "@/collab/handoff";
import { WebRTCService } from "@/webrtc/service";

beforeEach(() => {
  activeCollabService.value = null;
  activeCollabRoomId.value = "";
});

describe("shouldDisconnectOnUnmount", () => {
  // The bug this locks down: enterCollab() navigates to /collab, unmounting the
  // WebRTC view, whose cleanup called disconnect() unconditionally — closing the
  // room the editor was about to adopt, so getRoom() was null and the editor
  // reported "no active connection". Collaborative editing could never work.
  it("does NOT disconnect a service that has been handed off", () => {
    const svc = new WebRTCService();
    expect(shouldDisconnectOnUnmount(svc, svc)).toBe(false);
  });

  it("disconnects a service that was never handed off", () => {
    const svc = new WebRTCService();
    expect(shouldDisconnectOnUnmount(svc, null)).toBe(true);
  });

  it("disconnects when a different service was handed off", () => {
    const mine = new WebRTCService();
    const other = new WebRTCService();
    expect(shouldDisconnectOnUnmount(mine, other)).toBe(true);
  });

  it("has nothing to do without a service", () => {
    expect(shouldDisconnectOnUnmount(null, null)).toBe(false);
  });
});

describe("leaveCollab", () => {
  it("clears the handoff so a later view may tear its own service down", () => {
    const svc = new WebRTCService();
    activeCollabService.value = svc;
    activeCollabRoomId.value = "fy0wf1";

    leaveCollab();

    expect(activeCollabService.value).toBeNull();
    expect(activeCollabRoomId.value).toBe("");
    // Ownership released: a fresh view is free to disconnect its own service.
    expect(shouldDisconnectOnUnmount(svc, activeCollabService.value)).toBe(true);
  });

  it("returns the service to idle", () => {
    const svc = new WebRTCService();
    activeCollabService.value = svc;
    leaveCollab();
    expect(svc.state.value).toBe("idle");
  });

  it("is safe with no active session", () => {
    expect(() => leaveCollab()).not.toThrow();
    expect(activeCollabService.value).toBeNull();
  });
});
