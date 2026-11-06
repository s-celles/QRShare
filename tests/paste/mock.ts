import type { PasteRoom } from "@/paste/board";

type Receiver = (data: ArrayBuffer, peerId: string) => void;

/**
 * In-memory mesh for paste boards: links are explicit (partial connectivity),
 * sends can target one peer, frames are delivered asynchronously, and outgoing
 * actions can be dropped or recorded.
 */
export class PasteMockNet {
  readonly rooms: PasteMockRoom[] = [];

  room(id: string): PasteMockRoom {
    const r = new PasteMockRoom(id, this);
    this.rooms.push(r);
    return r;
  }

  link(a: PasteMockRoom, b: PasteMockRoom): void {
    if (a.peers.has(b.id)) return;
    a.peers.add(b.id);
    b.peers.add(a.id);
    a.joins.forEach((fn) => fn(b.id));
    b.joins.forEach((fn) => fn(a.id));
  }

  unlink(a: PasteMockRoom, b: PasteMockRoom): void {
    if (!a.peers.has(b.id)) return;
    a.peers.delete(b.id);
    b.peers.delete(a.id);
    a.leaves.forEach((fn) => fn(b.id));
    b.leaves.forEach((fn) => fn(a.id));
  }

  connectAll(): void {
    for (const a of this.rooms) for (const b of this.rooms) if (a !== b) this.link(a, b);
  }

  leave(room: PasteMockRoom): void {
    for (const other of this.rooms) if (other !== room) this.unlink(room, other);
    this.rooms.splice(this.rooms.indexOf(room), 1);
  }
}

export class PasteMockRoom implements PasteRoom {
  readonly receivers = new Map<string, Receiver[]>();
  readonly peers = new Set<string>();
  readonly joins = new Set<(peerId: string) => void>();
  readonly leaves = new Set<(peerId: string) => void>();
  /** Actions whose outgoing frames are silently dropped. */
  readonly drop = new Set<string>();
  /** Every frame sent: action, target ("*" for broadcast), size. */
  readonly sent: { action: string; to: string; size: number }[] = [];

  constructor(
    readonly id: string,
    private readonly net: PasteMockNet,
  ) {}

  makeAction(namespace: string): [(data: ArrayBuffer, target?: string | null) => Promise<void>, (fn: Receiver) => void] {
    const send = async (data: ArrayBuffer, target?: string | null): Promise<void> => {
      this.sent.push({ action: namespace, to: target ?? "*", size: data.byteLength });
      if (this.drop.has(namespace)) return;
      for (const other of this.net.rooms) {
        if (other === this || !this.peers.has(other.id)) continue;
        if (target && target !== other.id) continue;
        const copy = data.slice(0);
        setTimeout(() => {
          if (!this.peers.has(other.id)) return;
          for (const r of other.receivers.get(namespace) ?? []) r(copy, this.id);
        }, 0);
      }
    };
    const receive = (fn: Receiver): void => {
      const list = this.receivers.get(namespace) ?? [];
      list.push(fn);
      this.receivers.set(namespace, list);
    };
    return [send, receive];
  }

  /** Delivers a raw frame as if `from` had sent it. */
  inject(namespace: string, data: ArrayBuffer, from: string): void {
    for (const r of this.receivers.get(namespace) ?? []) r(data, from);
  }

  onPeerJoin(fn: (peerId: string) => void): void {
    this.joins.add(fn);
  }

  onPeerLeave(fn: (peerId: string) => void): void {
    this.leaves.add(fn);
  }
}

/** Waits until `cond` holds (frames are processed asynchronously). */
export async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Lets in-flight frames settle. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 1));
}
