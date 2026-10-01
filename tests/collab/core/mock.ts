import type { CollabRoom } from "@/collab/core/room";

type Receiver = (data: unknown, peerId: string) => void;

/** In-memory mesh delivering actions synchronously between connected rooms. */
export class MockNetwork {
  readonly rooms: MockRoom[] = [];
  /** Connect every room to every other (fires peer joins both ways). */
  connectAll(): void {
    const joins: (() => void)[] = [];
    for (const a of this.rooms) for (const b of this.rooms) if (a !== b && !a.peers.has(b.id)) {
      a.peers.add(b.id);
      joins.push(() => a.join?.(b.id));
    }
    for (const join of joins) join();
  }
  disconnect(room: MockRoom): void {
    for (const other of this.rooms) {
      if (other === room) continue;
      if (other.peers.delete(room.id)) other.leave?.(room.id);
      if (room.peers.delete(other.id)) room.leave?.(other.id);
    }
  }
}

/** Like a trystero room: a single onPeerJoin / onPeerLeave slot. */
export class MockRoom implements CollabRoom {
  readonly receivers = new Map<string, Receiver[]>();
  readonly peers = new Set<string>();
  join?: (peerId: string) => void;
  leave?: (peerId: string) => void;

  constructor(readonly id: string, private readonly net: MockNetwork) {
    net.rooms.push(this);
  }

  makeAction<T extends ArrayBuffer | string>(namespace: string): [(data: T, ...rest: unknown[]) => Promise<void>, (fn: (data: T, peerId: string) => void) => void, ...unknown[]] {
    const send = async (data: T): Promise<void> => {
      for (const other of this.net.rooms) {
        if (other === this || !this.peers.has(other.id)) continue;
        for (const r of other.receivers.get(namespace) ?? []) r(data instanceof ArrayBuffer ? data.slice(0) : data, this.id);
      }
    };
    const receive = (fn: (data: T, peerId: string) => void): void => {
      const list = this.receivers.get(namespace) ?? [];
      list.push(fn as Receiver);
      this.receivers.set(namespace, list);
    };
    return [send, receive];
  }

  onPeerJoin(fn: (peerId: string) => void) {
    this.join = fn;
  }
  onPeerLeave(fn: (peerId: string) => void) {
    this.leave = fn;
  }
}
