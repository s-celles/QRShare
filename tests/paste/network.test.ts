import { describe, expect, it } from "bun:test";
import { multiplexRooms, type StrategyRoom } from "@/paste/network";

/** A trystero-like room: single join/leave slot, peers listed by getPeers(). */
class FakeRoom implements StrategyRoom {
  peers = new Set<string>();
  join?: (p: string) => void;
  leaveFn?: (p: string) => void;
  sent: { ns: string; target?: string | string[] | null }[] = [];
  receivers = new Map<string, (data: ArrayBuffer, peer: string) => void>();
  left = false;
  makeAction(ns: string) {
    const send = (_data: ArrayBuffer, target?: string | string[] | null) => {
      this.sent.push({ ns, target });
      return Promise.resolve();
    };
    const receive = (fn: (data: ArrayBuffer, peer: string) => void) => void this.receivers.set(ns, fn);
    return [send, receive] as [typeof send, typeof receive];
  }
  onPeerJoin(fn: (p: string) => void) {
    this.join = fn;
  }
  onPeerLeave(fn: (p: string) => void) {
    this.leaveFn = fn;
  }
  getPeers() {
    return Object.fromEntries([...this.peers].map((p) => [p, {}])) as Record<string, RTCPeerConnection>;
  }
  async leave() {
    this.left = true;
  }
  add(p: string) {
    this.peers.add(p);
    this.join?.(p);
  }
  remove(p: string) {
    this.peers.delete(p);
    this.leaveFn?.(p);
  }
}

describe("REQ-PASTE-005 / REQ-PASTE-007 strategy multiplexing", () => {
  it("treats a peer as connected while at least one strategy room has it", () => {
    const [nostr, torrent] = [new FakeRoom(), new FakeRoom()];
    const mux = multiplexRooms([nostr, torrent]);
    const events: string[] = [];
    mux.room.onPeerJoin((p) => events.push(`+${p}`));
    mux.room.onPeerLeave((p) => events.push(`-${p}`));
    nostr.add("x");
    torrent.add("x");
    nostr.remove("x");
    expect(events).toEqual(["+x"]);
    torrent.remove("x");
    expect(events).toEqual(["+x", "-x"]);
  });

  it("sends on every room, and targeted sends only where the peer is", () => {
    const [nostr, torrent] = [new FakeRoom(), new FakeRoom()];
    const mux = multiplexRooms([nostr, torrent]);
    const [send] = mux.room.makeAction("paste");
    nostr.add("x");
    send(new ArrayBuffer(1));
    send(new ArrayBuffer(1), "x");
    expect(nostr.sent).toEqual([{ ns: "paste", target: null }, { ns: "paste", target: "x" }]);
    expect(torrent.sent).toEqual([{ ns: "paste", target: null }]);
  });

  it("delivers frames from every room to the same receiver, and leaves every room", async () => {
    const [nostr, torrent] = [new FakeRoom(), new FakeRoom()];
    const mux = multiplexRooms([nostr, torrent]);
    const [, receive] = mux.room.makeAction("pblob");
    const got: string[] = [];
    receive((_d, p) => got.push(p));
    nostr.receivers.get("pblob")!(new ArrayBuffer(1), "a");
    torrent.receivers.get("pblob")!(new ArrayBuffer(1), "b");
    expect(got).toEqual(["a", "b"]);
    // the same action is created once per room
    expect(mux.room.makeAction("pblob")[0]).toBeDefined();
    await mux.leave();
    expect(nostr.left && torrent.left).toBe(true);
  });
});
