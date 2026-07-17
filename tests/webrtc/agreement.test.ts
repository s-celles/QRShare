import { describe, expect, it } from "bun:test";
import {
  initAgreementState,
  reduceAgreement,
  resolveAgreementRole,
  type AgreementEffect,
  type AgreementEvent,
  type AgreementState,
} from "@/webrtc/agreement";

const LOW = "aaaaaaaaaaaaaaaaaaaa";
const HIGH = "zzzzzzzzzzzzzzzzzzzz";

/** Feed a sequence of events, collecting every effect emitted along the way. */
function run(
  state: AgreementState,
  events: AgreementEvent[],
): { state: AgreementState; effects: AgreementEffect[] } {
  let s = state;
  const effects: AgreementEffect[] = [];
  for (const e of events) {
    const r = reduceAgreement(s, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

const join = (strategy: "nostr" | "torrent" | "mqtt", peerId: string): AgreementEvent => ({
  type: "peer-join",
  strategy,
  peerId,
});

describe("resolveAgreementRole", () => {
  it("elects exactly one leader from the two peer ids", () => {
    expect(resolveAgreementRole(LOW, HIGH)).toBe("leader");
    expect(resolveAgreementRole(HIGH, LOW)).toBe("follower");
  });

  it("is deterministic: both sides compute complementary roles", () => {
    const a = resolveAgreementRole(LOW, HIGH);
    const b = resolveAgreementRole(HIGH, LOW);
    expect(a).not.toBe(b);
  });

  it("degrades to follower on the (practically impossible) identical-id tie", () => {
    expect(resolveAgreementRole(LOW, LOW)).toBe("follower");
  });
});

describe("reduceAgreement — the race [REQ-RELY-002]", () => {
  // The bug this locks down: each side independently adopting its own
  // first-joined strategy and tearing down the other's room.
  it("converges on the same strategy under OPPOSITE join orderings", () => {
    // Leader observes nostr first; follower observes torrent first.
    const leader = run(initAgreementState(LOW), [
      join("nostr", HIGH),
      join("torrent", HIGH),
    ]);
    const follower = run(initAgreementState(HIGH), [
      join("torrent", LOW),
      join("nostr", LOW),
    ]);

    // Leader decided on its own first join; follower has decided nothing yet.
    expect(leader.state.decided).toBe("nostr");
    expect(follower.state.decided).toBeNull();

    // The leader's announcement reaches the follower.
    const announced = leader.effects.find((e) => e.type === "announce");
    expect(announced).toEqual({ type: "announce", strategy: "nostr" });

    const settled = run(follower.state, [
      { type: "announcement", strategy: announced!.strategy },
    ]);

    expect(settled.state.decided).toBe("nostr");
    expect(leader.state.decided).toBe(settled.state.decided);
  });

  it("leader emits announce then activate on its first join", () => {
    const { effects } = run(initAgreementState(LOW), [join("nostr", HIGH)]);
    expect(effects).toEqual([
      { type: "announce", strategy: "nostr" },
      { type: "activate", strategy: "nostr" },
    ]);
  });

  it("follower emits no activate until the announcement arrives", () => {
    const joined = run(initAgreementState(HIGH), [
      join("torrent", LOW),
      join("nostr", LOW),
    ]);
    expect(joined.effects).toEqual([]);

    const after = run(joined.state, [{ type: "announcement", strategy: "torrent" }]);
    expect(after.effects).toEqual([{ type: "activate", strategy: "torrent" }]);
  });

  it("leader does not re-decide when a second strategy joins later", () => {
    const { state, effects } = run(initAgreementState(LOW), [
      join("nostr", HIGH),
      join("torrent", HIGH),
      join("mqtt", HIGH),
    ]);
    expect(state.decided).toBe("nostr");
    expect(effects.filter((e) => e.type === "activate")).toHaveLength(1);
    expect(effects.filter((e) => e.type === "announce")).toHaveLength(1);
  });
});

describe("reduceAgreement — grace fallback [REQ-RELY-006]", () => {
  it("follower adopts its first live joined strategy when no announcement arrives", () => {
    const { state, effects } = run(initAgreementState(HIGH), [
      join("torrent", LOW),
      join("nostr", LOW),
      { type: "grace-elapsed" },
    ]);
    expect(state.decided).toBe("torrent");
    expect(effects).toEqual([{ type: "activate", strategy: "torrent" }]);
  });

  it("grace fallback skips a strategy that died before agreement", () => {
    const { state, effects } = run(initAgreementState(HIGH), [
      join("torrent", LOW),
      join("nostr", LOW),
      { type: "peer-leave", strategy: "torrent", peerId: LOW },
      { type: "grace-elapsed" },
    ]);
    // torrent is dead — the survivor must be picked instead.
    expect(state.decided).toBe("nostr");
    expect(effects).toEqual([{ type: "activate", strategy: "nostr" }]);
  });

  it("grace does nothing when every joined strategy is dead", () => {
    const { state, effects } = run(initAgreementState(HIGH), [
      join("torrent", LOW),
      { type: "peer-leave", strategy: "torrent", peerId: LOW },
      { type: "grace-elapsed" },
    ]);
    expect(state.decided).toBeNull();
    expect(effects).toEqual([]);
  });

  it("grace is a no-op once a strategy is already decided", () => {
    const decided = run(initAgreementState(LOW), [join("nostr", HIGH)]);
    const after = run(decided.state, [{ type: "grace-elapsed" }]);
    expect(after.effects).toEqual([]);
    expect(after.state.decided).toBe("nostr");
  });

  it("identical-id tie: both sides are followers and resolve via grace", () => {
    const a = run(initAgreementState(LOW), [join("nostr", LOW), { type: "grace-elapsed" }]);
    const b = run(initAgreementState(LOW), [join("nostr", LOW), { type: "grace-elapsed" }]);
    expect(a.state.decided).toBe("nostr");
    expect(b.state.decided).toBe(a.state.decided);
  });
});

describe("reduceAgreement — peer-leave before agreement [REQ-RELY-007]", () => {
  it("marks the strategy dead and emits no error effect", () => {
    const { state, effects } = run(initAgreementState(HIGH), [
      join("nostr", LOW),
      { type: "peer-leave", strategy: "nostr", peerId: LOW },
    ]);
    expect(state.dead).toContain("nostr");
    expect(state.decided).toBeNull();
    expect(effects).toEqual([]);
  });

  it("a leave on a losing room after agreement does not disturb the decision", () => {
    const decided = run(initAgreementState(LOW), [join("nostr", HIGH)]);
    const after = run(decided.state, [
      { type: "peer-leave", strategy: "torrent", peerId: HIGH },
    ]);
    expect(after.state.decided).toBe("nostr");
    expect(after.effects).toEqual([]);
  });
});

describe("reduceAgreement — single strategy [REQ-RELY-008]", () => {
  it("leader activates the only strategy that ever connects", () => {
    const { state } = run(initAgreementState(LOW), [join("mqtt", HIGH)]);
    expect(state.decided).toBe("mqtt");
  });

  it("follower activates the only strategy via announcement", () => {
    const { state } = run(initAgreementState(HIGH), [
      join("mqtt", LOW),
      { type: "announcement", strategy: "mqtt" },
    ]);
    expect(state.decided).toBe("mqtt");
  });
});

describe("reduceAgreement — announcement idempotency", () => {
  it("ignores a repeated or late announcement once decided", () => {
    const first = run(initAgreementState(HIGH), [
      join("nostr", LOW),
      { type: "announcement", strategy: "nostr" },
    ]);
    const again = run(first.state, [
      { type: "announcement", strategy: "nostr" },
      { type: "announcement", strategy: "torrent" },
    ]);
    expect(again.effects).toEqual([]);
    expect(again.state.decided).toBe("nostr");
  });
});

describe("reduceAgreement — purity [REQ-RELY-070]", () => {
  it("does not mutate the input state", () => {
    const state = initAgreementState(LOW);
    const snapshot = JSON.stringify(state);
    reduceAgreement(state, join("nostr", HIGH));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
