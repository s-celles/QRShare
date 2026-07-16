import { describe, expect, it } from "bun:test";
import { CollabSession, type CollabRoom } from "@/collab/session";

type Receiver = (data: unknown, peerId: string) => void;

/** A tiny in-memory mesh that delivers actions between mock rooms synchronously. */
class MockNetwork {
  readonly rooms: MockRoom[] = [];
}

class MockRoom implements CollabRoom {
  private readonly receivers = new Map<string, Receiver[]>();
  private readonly peerJoinCbs: ((peerId: string) => void)[] = [];
  private readonly peerLeaveCbs: ((peerId: string) => void)[] = [];

  constructor(
    readonly id: string,
    private readonly net: MockNetwork,
  ) {
    net.rooms.push(this);
  }

  makeAction<T extends ArrayBuffer | string>(namespace: string): [
    (data: T, ...rest: unknown[]) => Promise<unknown>,
    (fn: (data: T, peerId: string) => void) => void,
    ...unknown[],
  ] {
    const sender = (data: T) => {
      for (const other of this.net.rooms) {
        if (other === this) continue;
        for (const r of other.receivers.get(namespace) ?? []) {
          r(data, this.id);
        }
      }
      return Promise.resolve([] as void[]);
    };
    const receiver = (fn: (data: T, peerId: string) => void) => {
      const list = this.receivers.get(namespace) ?? [];
      list.push(fn as Receiver);
      this.receivers.set(namespace, list);
    };
    const progress = () => {};
    return [sender, receiver, progress];
  }

  onPeerJoin(fn: (peerId: string) => void) {
    this.peerJoinCbs.push(fn);
  }

  onPeerLeave(fn: (peerId: string) => void) {
    this.peerLeaveCbs.push(fn);
  }

  emitJoin(peerId: string) {
    for (const fn of this.peerJoinCbs) fn(peerId);
  }

  emitLeave(peerId: string) {
    for (const fn of this.peerLeaveCbs) fn(peerId);
  }
}

function pair() {
  const net = new MockNetwork();
  const roomA = new MockRoom("A", net);
  const roomB = new MockRoom("B", net);
  const sessionA = new CollabSession(roomA, { siteId: "A" });
  const sessionB = new CollabSession(roomB, { siteId: "B" });
  return { roomA, roomB, sessionA, sessionB };
}

describe("CollabSession live sync", () => {
  it("broadcasts local edits and applies received updates without echo", () => {
    const { sessionA, sessionB } = pair();
    let bLocalUpdates = 0;
    sessionB.doc.onUpdate(() => {
      bLocalUpdates++;
    });

    sessionA.setText("hello from A");
    expect(sessionB.docText.value).toBe("hello from A");
    // B never saw a *local* update — everything it got was remote-applied.
    expect(bLocalUpdates).toBe(0);
  });

  it("converges under bidirectional concurrent edits", () => {
    const { sessionA, sessionB } = pair();
    sessionA.setText("abc");
    sessionA.setText("aXbc");
    sessionB.setText(sessionB.docText.value.replace("abc", "abc")); // no-op guard
    sessionB.setText(sessionB.docText.value + "!");
    expect(sessionA.docText.value).toBe(sessionB.docText.value);
  });
});

describe("CollabSession state-vector handshake", () => {
  it("brings a late-joining peer up to the current state", () => {
    const net = new MockNetwork();
    const roomA = new MockRoom("A", net);
    const sessionA = new CollabSession(roomA, { siteId: "A" });
    sessionA.setText("existing document content");

    // B joins later with an empty doc.
    const roomB = new MockRoom("B", net);
    const sessionB = new CollabSession(roomB, { siteId: "B" });
    expect(sessionB.docText.value).toBe("");

    // Simulate the peer-join event on both sides -> handshake runs.
    roomA.emitJoin("B");
    roomB.emitJoin("A");

    expect(sessionB.docText.value).toBe("existing document content");
    expect(sessionA.docText.value).toBe(sessionB.docText.value);
  });

  it("replays the version log to a joining peer during resync", () => {
    const net = new MockNetwork();
    const roomA = new MockRoom("A", net);
    const sessionA = new CollabSession(roomA, { siteId: "A" });
    sessionA.setText("versioned doc");
    sessionA.saveVersion("checkpoint");

    const roomB = new MockRoom("B", net);
    const sessionB = new CollabSession(roomB, { siteId: "B" });
    expect(sessionB.versions.value).toHaveLength(0);

    roomA.emitJoin("B");
    roomB.emitJoin("A");

    expect(sessionB.versions.value).toHaveLength(1);
    expect(sessionB.versions.value[0].label).toBe("checkpoint");
  });
});

describe("CollabSession versioning", () => {
  it("propagates a saved version to the peer over the version action", () => {
    const { sessionA, sessionB } = pair();
    sessionA.setText("save me");
    sessionA.saveVersion("v1");
    expect(sessionB.versions.value.map((v) => v.label)).toEqual(["v1"]);
  });

  it("restore broadcasts as a normal doc-update so both peers converge", () => {
    const { sessionA, sessionB } = pair();
    sessionA.setText("original");
    const saved = sessionA.saveVersion("snap");

    // Both peers move on.
    sessionA.setText("diverged text after snapshot");
    expect(sessionB.docText.value).toBe("diverged text after snapshot");

    // A restores the snapshot; both converge back to it.
    sessionA.restoreVersion(saved.id);
    expect(sessionA.docText.value).toBe("original");
    expect(sessionB.docText.value).toBe("original");
  });

  it("presence flips on peer join and leave", () => {
    const { roomA, sessionA } = pair();
    expect(sessionA.peerOnline.value).toBe(false);
    roomA.emitJoin("B");
    expect(sessionA.peerOnline.value).toBe(true);
    roomA.emitLeave("B");
    expect(sessionA.peerOnline.value).toBe(false);
  });
});

describe("CollabSession integration", () => {
  it("connect -> concurrent edit -> save -> restore converges and logs match", () => {
    const net = new MockNetwork();
    const roomA = new MockRoom("A", net);
    const roomB = new MockRoom("B", net);
    const sessionA = new CollabSession(roomA, { siteId: "A" });
    const sessionB = new CollabSession(roomB, { siteId: "B" });

    roomA.emitJoin("B");
    roomB.emitJoin("A");

    sessionA.setText("shared");
    sessionB.setText(sessionB.docText.value + " document");
    expect(sessionA.docText.value).toBe(sessionB.docText.value);

    const saved = sessionA.saveVersion("milestone");
    // Both logs contain the entry, deduped.
    expect(sessionB.versions.value).toHaveLength(1);
    expect(sessionA.versions.value).toHaveLength(1);

    sessionB.setText("totally different");
    sessionB.restoreVersion(saved.id);

    expect(sessionA.docText.value).toBe(sessionB.docText.value);
    expect(sessionA.versions.value.map((v) => v.id)).toEqual(
      sessionB.versions.value.map((v) => v.id),
    );
  });
});
