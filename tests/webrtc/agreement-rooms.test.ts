import { describe, expect, it } from "bun:test";
import { StrategyAgreement, type AgreementRoom } from "@/webrtc/agreement";
import type { StrategyName } from "@/webrtc/strategies";

const LOW = "aaaaaaaaaaaaaaaaaaaa";
const HIGH = "zzzzzzzzzzzzzzzzzzzz";

type Receiver = (data: unknown, peerId: string) => void;

/** One in-memory mesh per strategy: rooms of the same strategy talk to each other. */
class MockNetwork {
  readonly rooms: MockRoom[] = [];
}

class MockRoom implements AgreementRoom {
  private readonly receivers = new Map<string, Receiver[]>();
  private readonly peerJoinCbs: ((peerId: string) => void)[] = [];
  private readonly peerLeaveCbs: ((peerId: string) => void)[] = [];
  leaveCount = 0;

  constructor(
    readonly id: string,
    private readonly net: MockNetwork,
  ) {
    net.rooms.push(this);
  }

  makeAction<T extends string>(namespace: string): [
    (data: T, ...rest: never[]) => unknown,
    (fn: (data: T, peerId: string) => void) => void,
    ...unknown[],
  ] {
    const sender = (data: T) => {
      for (const other of this.net.rooms) {
        if (other === this) continue;
        for (const r of other.receivers.get(namespace) ?? []) r(data, this.id);
      }
      return Promise.resolve([]);
    };
    const receiver = (fn: (data: T, peerId: string) => void) => {
      const list = this.receivers.get(namespace) ?? [];
      list.push(fn as Receiver);
      this.receivers.set(namespace, list);
    };
    return [sender, receiver, () => {}];
  }

  onPeerJoin(fn: (peerId: string) => void) {
    this.peerJoinCbs.push(fn);
  }
  onPeerLeave(fn: (peerId: string) => void) {
    this.peerLeaveCbs.push(fn);
  }
  leave() {
    this.leaveCount++;
  }

  emitJoin(peerId: string) {
    for (const fn of this.peerJoinCbs) fn(peerId);
  }
  emitLeave(peerId: string) {
    for (const fn of this.peerLeaveCbs) fn(peerId);
  }
  /** Has an action namespace been registered on this room? */
  hasAction(namespace: string) {
    return (this.receivers.get(namespace) ?? []).length > 0;
  }
}

/** A scheduler the test drives by hand — no real timers, no flake. */
function manualScheduler() {
  const pending: (() => void)[] = [];
  const schedule = (fn: () => void) => {
    pending.push(fn);
    return () => {
      const i = pending.indexOf(fn);
      if (i >= 0) pending.splice(i, 1);
    };
  };
  return { schedule, fire: () => [...pending].forEach((fn) => fn()), pending };
}

interface Peer {
  agreement: StrategyAgreement;
  rooms: Record<StrategyName, MockRoom>;
  activated: { strategy: StrategyName; peerId: string }[];
  grace: ReturnType<typeof manualScheduler>;
}

function buildPair(strategies: StrategyName[]) {
  const nets: Partial<Record<StrategyName, MockNetwork>> = {};
  for (const s of strategies) nets[s] = new MockNetwork();

  const mk = (selfId: string): Peer => {
    const rooms = {} as Record<StrategyName, MockRoom>;
    for (const s of strategies) rooms[s] = new MockRoom(selfId, nets[s]!);
    const activated: { strategy: StrategyName; peerId: string }[] = [];
    const grace = manualScheduler();
    const agreement = new StrategyAgreement({
      selfId,
      rooms: strategies.map((s) => ({ strategy: s, room: rooms[s] })),
      onActivate: (strategy, _room, peerId) => activated.push({ strategy, peerId }),
      schedule: grace.schedule,
    });
    return { agreement, rooms, activated, grace };
  };

  return { a: mk(LOW), b: mk(HIGH) };
}

describe("StrategyAgreement — action registration [REQ-RELY-012]", () => {
  it("registers the announcement action on EVERY room at construction", () => {
    const { a } = buildPair(["nostr", "torrent", "mqtt"]);
    expect(a.rooms.nostr.hasAction("strat")).toBe(true);
    expect(a.rooms.torrent.hasAction("strat")).toBe(true);
    expect(a.rooms.mqtt.hasAction("strat")).toBe(true);
  });

  it("uses an action name within trystero's 12-byte cap", () => {
    expect(new TextEncoder().encode(StrategyAgreement.ACTION).length).toBeLessThanOrEqual(12);
  });
});

describe("StrategyAgreement — the race over mock rooms [REQ-RELY-002, REQ-RELY-072]", () => {
  it("both peers activate the same strategy under opposite join orders", () => {
    const { a, b } = buildPair(["nostr", "torrent"]);

    // Opposite observation orders — the exact shape of the old race.
    a.rooms.nostr.emitJoin(HIGH);
    b.rooms.torrent.emitJoin(LOW);
    a.rooms.torrent.emitJoin(HIGH);
    b.rooms.nostr.emitJoin(LOW);

    expect(a.activated.map((x) => x.strategy)).toEqual(["nostr"]);
    expect(b.activated.map((x) => x.strategy)).toEqual(["nostr"]);
    expect(a.activated[0].peerId).toBe(HIGH);
    expect(b.activated[0].peerId).toBe(LOW);
  });

  it("leaves the losing rooms exactly once, and never the kept room", () => {
    const { a, b } = buildPair(["nostr", "torrent"]);

    a.rooms.nostr.emitJoin(HIGH);
    b.rooms.torrent.emitJoin(LOW);
    a.rooms.torrent.emitJoin(HIGH);
    b.rooms.nostr.emitJoin(LOW);

    expect(a.rooms.nostr.leaveCount).toBe(0);
    expect(a.rooms.torrent.leaveCount).toBe(1);
    expect(b.rooms.nostr.leaveCount).toBe(0);
    expect(b.rooms.torrent.leaveCount).toBe(1);
  });

  it("a pre-agreement peer-leave on a losing room does not derail the agreement", () => {
    const { a, b } = buildPair(["nostr", "torrent"]);

    b.rooms.torrent.emitJoin(LOW);
    // The leader tears torrent down; the follower sees the leave before the announce.
    b.rooms.torrent.emitLeave(LOW);
    a.rooms.nostr.emitJoin(HIGH);
    b.rooms.nostr.emitJoin(LOW);

    expect(a.activated.map((x) => x.strategy)).toEqual(["nostr"]);
    expect(b.activated.map((x) => x.strategy)).toEqual(["nostr"]);
  });

  it("activates only once even if more strategies join afterwards", () => {
    const { a } = buildPair(["nostr", "torrent", "mqtt"]);
    a.rooms.nostr.emitJoin(HIGH);
    a.rooms.torrent.emitJoin(HIGH);
    a.rooms.mqtt.emitJoin(HIGH);
    expect(a.activated).toHaveLength(1);
  });
});

describe("StrategyAgreement — follower grace fallback [REQ-RELY-006]", () => {
  it("fires when the announcement never arrives (sequential / legacy peer)", () => {
    const { b } = buildPair(["nostr", "torrent"]);

    // No leader on the other side: nothing ever announces.
    b.rooms.torrent.emitJoin(LOW);
    expect(b.activated).toEqual([]); // still waiting

    b.grace.fire();

    expect(b.activated.map((x) => x.strategy)).toEqual(["torrent"]);
  });

  it("picks a strategy that is still alive", () => {
    const { b } = buildPair(["nostr", "torrent"]);

    b.rooms.torrent.emitJoin(LOW);
    b.rooms.nostr.emitJoin(LOW);
    b.rooms.torrent.emitLeave(LOW); // torrent died before agreement
    b.grace.fire();

    expect(b.activated.map((x) => x.strategy)).toEqual(["nostr"]);
  });

  it("does not fire once the announcement already settled things", () => {
    const { a, b } = buildPair(["nostr", "torrent"]);
    a.rooms.nostr.emitJoin(HIGH);
    b.rooms.nostr.emitJoin(LOW);
    expect(b.activated).toHaveLength(1);

    b.grace.fire();
    expect(b.activated).toHaveLength(1);
  });

  it("the leader never needs the grace timer", () => {
    const { a } = buildPair(["nostr", "torrent"]);
    a.rooms.nostr.emitJoin(HIGH);
    a.grace.fire();
    expect(a.activated).toHaveLength(1);
  });
});

describe("StrategyAgreement — destroy", () => {
  it("cancels a pending grace timer", () => {
    const { b } = buildPair(["nostr"]);
    b.rooms.nostr.emitJoin(LOW);
    b.agreement.destroy();
    b.grace.fire();
    expect(b.activated).toEqual([]);
  });
});
