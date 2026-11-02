/**
 * Audio session room: host/guest state machine (REQ-ALS-001..017, 032).
 *
 * Pure: no audio, no DOM. Inputs are received link packets and the passage of time
 * (injected clock and random source); outputs are packet bodies to transmit
 * (`nextFrame`) and UI events. The radio side (when a frame may be sent) is the
 * caller's business (see `mac.ts`).
 *
 * Designed for several members: ids, per-sender reliable sequence numbers, a group
 * key, and grouped acknowledgements (each PRESENCE lists, per member, the highest
 * contiguous message number received).
 */

import { colorOf, createIdentity } from "@/collab/core/identity";
import { encodeLinkBody, encodeLinkHeader, type AudioPacket } from "../packet";
import {
  fingerprint,
  filePassword,
  generateKeyPair,
  importGroupKey,
  linkNonce,
  newGroupKey,
  openLink,
  pairwiseKey,
  sealLink,
  verificationCode,
  type LinkKeyPair,
  type MemberEntry,
} from "./crypto";
import {
  LinkKind,
  decodeBeacon,
  decodeChat,
  decodeFileDone,
  decodeJoin,
  decodeMembers,
  decodePresence,
  decodeRseqOnly,
  decodeWelcome,
  encodeBeacon,
  encodeChat,
  encodeFileDone,
  encodeJoin,
  encodeMembers,
  encodePresence,
  encodeRseqOnly,
  encodeWelcome,
} from "./protocol";

export type LinkPacket = Extract<AudioPacket, { kind: "link" }>;

export const MAX_MEMBERS = 6;
export const TIMING = {
  beaconAloneMs: 4000,
  beaconOpenMs: 15000,
  joinRetryMs: 5000,
  joinMaxTries: 12,
  retryMs: 6000,
  maxSends: 6,
  ackDelayMinMs: 300,
  ackDelayMaxMs: 1500,
  heartbeatMs: 20000,
  awayMs: 75000,
} as const;

export interface MemberView {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly self: boolean;
  readonly host: boolean;
  readonly away: boolean;
}

export type RoomEvent =
  | { kind: "room_found"; roomId: string; hostName: string; profileIndex: number }
  | { kind: "joined" }
  | { kind: "join_failed" }
  | { kind: "members"; members: MemberView[]; code: string }
  | { kind: "message"; from: number; name: string; text: string; rseq: number; at: number }
  | { kind: "delivery"; rseq: number; receivedBy: number; total: number; status: "pending" | "delivered" | "failed" }
  | { kind: "file_done"; from: number; transferId: string }
  | { kind: "left"; id: number; name: string }
  | { kind: "security_warning" };

export interface RoomOptions {
  readonly name?: string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly profileIndex?: number;
  readonly maxMembers?: number;
}

interface Member {
  id: number;
  fp: Uint8Array;
  publicRaw?: Uint8Array;
  name: string;
  lastHeard: number;
  /** Highest contiguous rseq of OUR messages this member acknowledged. */
  ackedUpTo: number;
  /** rseqs received from this member, and the highest contiguous one. */
  received: Set<number>;
  contiguous: number;
}

interface Outgoing {
  rseq: number;
  kind: number;
  payload: Uint8Array;
  sends: number;
  lastSent: number;
  /** When it may be sent again (jitter drawn once per send, so checks are stable). */
  nextAt: number;
  status: "pending" | "delivered" | "failed";
}

interface FoundRoom {
  roomId: Uint8Array;
  hostId: number;
  hostPub: Uint8Array;
  hostName: string;
  profileIndex: number;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const randomU32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class AudioRoom {
  readonly role: "host" | "guest";
  readonly selfId: number;
  readonly name: string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly keys: LinkKeyPair;
  private readonly selfFp: Uint8Array;
  private readonly maxMembers: number;
  profileIndex: number;
  state: "listening" | "joining" | "member" | "left";

  private roomId: Uint8Array | null = null;
  private hostId = 0;
  private hostPub: Uint8Array | null = null;
  private groupKeyRaw: Uint8Array | null = null;
  private groupKey: CryptoKey | null = null;
  private epoch = 0;
  private code = "";
  private counter = 0;
  private rseq = 0;
  private readonly members = new Map<number, Member>();
  private readonly outgoing = new Map<number, Outgoing>();
  private readonly found = new Map<string, FoundRoom>();
  private readonly welcomeQueue = new Set<number>();
  private target: FoundRoom | null = null;
  private joinTries = 0;
  private nextJoinAt = 0;
  private nextBeaconAt = 0;
  private ackDueAt = Infinity;
  private lastPresence = 0;
  private membersDue = false;

  private constructor(role: "host" | "guest", keys: LinkKeyPair, selfFp: Uint8Array, opts: RoomOptions) {
    this.role = role;
    this.keys = keys;
    this.selfFp = selfFp;
    this.selfId = randomU32() || 1;
    this.name = opts.name ?? createIdentity().name;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.profileIndex = opts.profileIndex ?? 0;
    this.maxMembers = opts.maxMembers ?? MAX_MEMBERS;
    this.state = role === "host" ? "member" : "listening";
  }

  /** Creates a room (REQ-ALS-001). */
  static async host(opts: RoomOptions = {}): Promise<AudioRoom> {
    const keys = await generateKeyPair();
    const room = new AudioRoom("host", keys, await fingerprint(keys.publicRaw), opts);
    room.roomId = crypto.getRandomValues(new Uint8Array(4));
    room.hostId = room.selfId;
    room.hostPub = keys.publicRaw;
    room.groupKeyRaw = newGroupKey();
    room.groupKey = await importGroupKey(room.groupKeyRaw);
    room.addMember(room.selfId, room.selfFp, room.name, keys.publicRaw);
    await room.recomputeCode();
    return room;
  }

  /** Listens for rooms to join (REQ-ALS-002). */
  static async guest(opts: RoomOptions = {}): Promise<AudioRoom> {
    const keys = await generateKeyPair();
    return new AudioRoom("guest", keys, await fingerprint(keys.publicRaw), opts);
  }

  get roomIdHex(): string | null {
    return this.roomId ? hex(this.roomId) : null;
  }

  /** Join requests sent so far (shown while joining). */
  get joinAttempts(): number {
    return this.joinTries;
  }

  get verificationCode(): string {
    return this.code;
  }

  /** Password of the sealed file transfers of this session (REQ-ALS-030). */
  async filePassword(): Promise<string | null> {
    return this.groupKeyRaw ? filePassword(this.groupKeyRaw) : null;
  }

  memberViews(): MemberView[] {
    const now = this.now();
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      color: colorOf(m.name),
      self: m.id === this.selfId,
      host: m.id === this.hostId,
      away: m.id !== this.selfId && now - m.lastHeard > TIMING.awayMs,
    }));
  }

  /** Other members (who must acknowledge our messages). */
  private others(): Member[] {
    return [...this.members.values()].filter((m) => m.id !== this.selfId);
  }

  private addMember(id: number, fp: Uint8Array, name: string, publicRaw?: Uint8Array): Member {
    let m = this.members.get(id);
    if (!m) {
      m = { id, fp, publicRaw, name, lastHeard: this.now(), ackedUpTo: 0, received: new Set(), contiguous: 0 };
      this.members.set(id, m);
    } else {
      m.fp = fp;
      if (publicRaw) m.publicRaw = publicRaw;
      if (name) m.name = name;
    }
    return m;
  }

  private entries(): MemberEntry[] {
    return [...this.members.values()].map((m) => ({ id: m.id, fp: m.fp }));
  }

  private async recomputeCode(): Promise<void> {
    if (this.groupKeyRaw && this.hostPub) this.code = await verificationCode(this.groupKeyRaw, this.hostPub, this.entries());
  }

  private membersEvent(): RoomEvent {
    return { kind: "members", members: this.memberViews(), code: this.code };
  }

  // ------------------------------------------------------------------ actions

  /** Guest: asks to join a room found by its beacon. */
  join(roomIdHex: string): RoomEvent[] {
    const room = this.found.get(roomIdHex);
    if (this.role !== "guest" || !room || this.state === "member") return [];
    this.target = room;
    this.roomId = room.roomId;
    this.hostId = room.hostId;
    this.hostPub = room.hostPub;
    this.profileIndex = room.profileIndex;
    this.state = "joining";
    this.joinTries = 0;
    this.nextJoinAt = this.now();
    return [];
  }

  /** Queues a chat message; returns its number (REQ-ALS-011). */
  sendChat(text: string): number {
    return this.queueReliable(LinkKind.Chat, (rseq) => encodeChat({ rseq, text }));
  }

  /** Reports a session file as received (REQ-ALS-032). */
  sendFileDone(transferId: Uint8Array): number {
    return this.queueReliable(LinkKind.FileDone, (rseq) => encodeFileDone({ rseq, transferId }));
  }

  /** Leaves the room; the leave message is sent once (REQ-ALS-017). */
  leave(): void {
    if (this.state !== "member") {
      this.state = "left";
      return;
    }
    this.queueReliable(LinkKind.Leave, (rseq) => encodeRseqOnly(rseq));
    this.state = "left";
  }

  private queueReliable(kind: number, build: (rseq: number) => Uint8Array): number {
    if (this.state !== "member" && !(kind === LinkKind.Leave)) throw new Error("Not in a room");
    const rseq = ++this.rseq;
    this.outgoing.set(rseq, { rseq, kind, payload: build(rseq), sends: 0, lastSent: 0, nextAt: 0, status: "pending" });
    return rseq;
  }

  // ------------------------------------------------------------------ timers

  /** Time-driven state: deliveries given up, members away. */
  tick(): RoomEvent[] {
    const now = this.now();
    const events: RoomEvent[] = [];
    for (const o of this.outgoing.values()) {
      if (o.status === "pending" && o.sends >= TIMING.maxSends && now - o.lastSent >= TIMING.retryMs) {
        o.status = "failed";
        events.push(this.deliveryEvent(o));
      }
    }
    if (this.state === "joining" && this.joinTries >= TIMING.joinMaxTries && now >= this.nextJoinAt) {
      this.state = "listening";
      this.target = null;
      events.push({ kind: "join_failed" });
    }
    return events;
  }

  private deliveryEvent(o: Outgoing): RoomEvent {
    const others = this.others();
    const receivedBy = others.filter((m) => m.ackedUpTo >= o.rseq).length;
    return { kind: "delivery", rseq: o.rseq, receivedBy, total: others.length, status: o.status };
  }

  /** True when a frame is waiting (the caller may then ask the MAC for a turn). */
  hasDue(): boolean {
    return this.dueKind() !== null;
  }

  private dueKind(): "welcome" | "ack" | "join" | "members" | "reliable" | "beacon" | "heartbeat" | null {
    const now = this.now();
    if (this.role === "host" && this.welcomeQueue.size > 0) return "welcome";
    if (this.state === "member" && now >= this.ackDueAt) return "ack";
    if (this.state === "joining" && now >= this.nextJoinAt && this.joinTries < TIMING.joinMaxTries) return "join";
    if (this.role === "host" && this.membersDue) return "members";
    if (this.dueReliable()) return "reliable";
    if (this.role === "host" && this.state === "member" && this.members.size < this.maxMembers && now >= this.nextBeaconAt) return "beacon";
    if (this.state === "member" && this.others().length > 0 && now - this.lastPresence >= TIMING.heartbeatMs) return "heartbeat";
    return null;
  }

  private dueReliable(): Outgoing | null {
    const now = this.now();
    const hasOthers = this.others().length > 0;
    for (const o of this.outgoing.values()) {
      if (o.status !== "pending") continue;
      if (o.kind === LinkKind.Leave) {
        if (o.sends === 0) return o;
        continue;
      }
      if (!hasOthers) continue;
      if (o.sends >= TIMING.maxSends) continue;
      if (now >= o.nextAt) return o;
    }
    return null;
  }

  private header(kind: number): { header: Uint8Array; fields: { roomId: Uint8Array; from: number; kind: number; counter: number } } {
    const fields = { roomId: this.roomId!, from: this.selfId, kind, counter: ++this.counter };
    return { header: encodeLinkHeader(fields), fields };
  }

  private async sealed(kind: number, plain: Uint8Array, key: CryptoKey | null = this.groupKey): Promise<Uint8Array> {
    const { header, fields } = this.header(kind);
    const payload = await sealLink(key!, linkNonce(this.selfId, fields.counter, kind), header, plain);
    return encodeLinkBody(fields, payload);
  }

  private clear(kind: number, payload: Uint8Array): Uint8Array {
    const { fields } = this.header(kind);
    return encodeLinkBody(fields, payload);
  }

  /** The next packet body to transmit, or null. Call when the channel is free. */
  async nextFrame(): Promise<Uint8Array | null> {
    const now = this.now();
    switch (this.dueKind()) {
      case "welcome": {
        const id = this.welcomeQueue.values().next().value!;
        this.welcomeQueue.delete(id);
        const m = this.members.get(id);
        if (!m?.publicRaw) return this.nextFrame();
        const key = await pairwiseKey(this.keys.privateKey, m.publicRaw, this.roomId!);
        return this.sealed(LinkKind.Welcome, encodeWelcome({ target: id, epoch: this.epoch, groupKey: this.groupKeyRaw!, members: this.entries() }), key);
      }
      case "ack":
      case "heartbeat": {
        this.ackDueAt = Infinity;
        this.lastPresence = now;
        const acks = this.others().map((m) => ({ id: m.id, rseq: m.contiguous }));
        return this.sealed(LinkKind.Presence, encodePresence({ name: this.name, acks }));
      }
      case "join": {
        this.joinTries++;
        this.nextJoinAt = now + TIMING.joinRetryMs + this.random() * 2000;
        return this.clear(LinkKind.Join, encodeJoin({ publicRaw: this.keys.publicRaw, name: this.name }));
      }
      case "members": {
        this.membersDue = false;
        return this.sealed(LinkKind.Members, encodeMembers({ epoch: this.epoch, members: this.entries() }));
      }
      case "reliable": {
        const o = this.dueReliable()!;
        o.sends++;
        o.lastSent = now;
        o.nextAt = now + TIMING.retryMs + this.random() * 2000;
        if (o.kind === LinkKind.Leave) o.status = "delivered";
        return this.sealed(o.kind, o.payload);
      }
      case "beacon": {
        this.nextBeaconAt = now + (this.others().length ? TIMING.beaconOpenMs : TIMING.beaconAloneMs) * (0.8 + 0.4 * this.random());
        return this.clear(LinkKind.Beacon, encodeBeacon({ publicRaw: this.keys.publicRaw, profileIndex: this.profileIndex, name: this.name }));
      }
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------- receive

  async receive(p: LinkPacket): Promise<RoomEvent[]> {
    if (p.from === this.selfId || this.state === "left") return []; // our own echo (REQ-ALS-007)
    if (p.linkKind === LinkKind.Beacon) return this.onBeacon(p);
    if (!this.roomId || !equal(p.roomId, this.roomId)) return []; // another room
    const sender = this.members.get(p.from);
    if (sender) sender.lastHeard = this.now();

    switch (p.linkKind) {
      case LinkKind.Join:
        return this.onJoin(p);
      case LinkKind.Welcome:
        return this.onWelcome(p);
      default:
        break;
    }
    if (this.state !== "member" || !this.groupKey) return [];
    const plain = await openLink(this.groupKey, linkNonce(p.from, p.counter, p.linkKind), p.header, p.payload);
    if (!plain) return [];
    switch (p.linkKind) {
      case LinkKind.Members:
        return this.onMembers(p.from, plain);
      case LinkKind.Presence:
        return this.onPresence(p.from, plain);
      case LinkKind.Chat:
        return this.onReliable(p.from, plain, LinkKind.Chat);
      case LinkKind.Leave:
        return this.onReliable(p.from, plain, LinkKind.Leave);
      case LinkKind.FileDone:
        return this.onReliable(p.from, plain, LinkKind.FileDone);
      default:
        return [];
    }
  }

  private onBeacon(p: LinkPacket): RoomEvent[] {
    if (this.role !== "guest" || this.state === "member") return [];
    const b = decodeBeacon(p.payload);
    if (!b) return [];
    const id = hex(p.roomId);
    const known = this.found.get(id);
    this.found.set(id, { roomId: p.roomId, hostId: p.from, hostPub: b.publicRaw, hostName: b.name, profileIndex: b.profileIndex });
    if (known && equal(known.hostPub, b.publicRaw) && known.hostName === b.name) return [];
    return [{ kind: "room_found", roomId: id, hostName: b.name, profileIndex: b.profileIndex }];
  }

  private async onJoin(p: LinkPacket): Promise<RoomEvent[]> {
    if (this.role !== "host") return [];
    const j = decodeJoin(p.payload);
    if (!j) return [];
    const fp = await fingerprint(j.publicRaw);
    const existing = this.members.get(p.from);
    if (existing) {
      // Same member asking again (welcome lost): answer the same way. Another key under
      // the same id is an id collision or a forgery: ignore it.
      if (existing.publicRaw && equal(existing.publicRaw, j.publicRaw)) this.welcomeQueue.add(p.from);
      return [];
    }
    if (this.members.size >= this.maxMembers) return [];
    const m = this.addMember(p.from, fp, j.name, j.publicRaw);
    m.lastHeard = this.now();
    this.epoch = (this.epoch + 1) & 0xff;
    await this.recomputeCode();
    this.welcomeQueue.add(p.from);
    if (this.others().length > 1) this.membersDue = true;
    return [this.membersEvent()];
  }

  private async onWelcome(p: LinkPacket): Promise<RoomEvent[]> {
    if (this.role !== "guest" || this.state !== "joining" || !this.target || p.from !== this.hostId) return [];
    const key = await pairwiseKey(this.keys.privateKey, this.target.hostPub, this.roomId!);
    const plain = await openLink(key, linkNonce(p.from, p.counter, p.linkKind), p.header, p.payload);
    if (!plain) return [];
    const w = decodeWelcome(plain);
    if (!w || w.target !== this.selfId) return [];
    const mine = w.members.find((m) => m.id === this.selfId);
    if (!mine || !equal(mine.fp, this.selfFp)) {
      // Our key was replaced on the way: someone is in the middle (REQ-ALS-005).
      this.state = "listening";
      this.target = null;
      return [{ kind: "security_warning" }];
    }
    this.groupKeyRaw = w.groupKey;
    this.groupKey = await importGroupKey(w.groupKey);
    this.epoch = w.epoch;
    this.state = "member";
    for (const e of w.members) {
      const name = e.id === this.selfId ? this.name : e.id === this.hostId ? this.target.hostName : "";
      this.addMember(e.id, e.fp, name, e.id === this.hostId ? this.target.hostPub : undefined);
    }
    await this.recomputeCode();
    this.ackDueAt = this.now() + this.ackDelay(); // introduce ourselves (name) quickly
    return [{ kind: "joined" }, this.membersEvent()];
  }

  private async onMembers(from: number, plain: Uint8Array): Promise<RoomEvent[]> {
    if (from !== this.hostId) return [];
    const m = decodeMembers(plain);
    if (!m || ((m.epoch - this.epoch) & 0xff) > 127) return []; // stale list
    this.epoch = m.epoch;
    const ids = new Set(m.members.map((e) => e.id));
    const events: RoomEvent[] = [];
    for (const old of [...this.members.values()]) {
      if (!ids.has(old.id)) {
        this.members.delete(old.id);
        events.push({ kind: "left", id: old.id, name: old.name });
      }
    }
    for (const e of m.members) this.addMember(e.id, e.fp, this.members.get(e.id)?.name ?? "");
    await this.recomputeCode();
    events.push(this.membersEvent());
    return events;
  }

  private onPresence(from: number, plain: Uint8Array): RoomEvent[] {
    const pr = decodePresence(plain);
    const m = this.members.get(from);
    if (!pr || !m) return [];
    const events: RoomEvent[] = [];
    const renamed = m.name !== pr.name;
    m.name = pr.name;
    const mine = pr.acks.find((a) => a.id === this.selfId);
    if (mine && mine.rseq > m.ackedUpTo) {
      m.ackedUpTo = mine.rseq;
      for (const o of this.outgoing.values()) {
        if (o.status === "pending" && o.kind !== LinkKind.Leave && o.rseq <= mine.rseq) events.push(...this.updateDelivery(o));
      }
    }
    if (renamed) events.push(this.membersEvent());
    return events;
  }

  private updateDelivery(o: Outgoing): RoomEvent[] {
    const others = this.others();
    if (others.every((m) => m.ackedUpTo >= o.rseq)) o.status = "delivered";
    return [this.deliveryEvent(o)];
  }

  private ackDelay(): number {
    return TIMING.ackDelayMinMs + this.random() * (TIMING.ackDelayMaxMs - TIMING.ackDelayMinMs);
  }

  private async onReliable(from: number, plain: Uint8Array, kind: number): Promise<RoomEvent[]> {
    const m = this.members.get(from);
    if (!m) return [];
    const rseq = kind === LinkKind.Chat ? decodeChat(plain)?.rseq : kind === LinkKind.FileDone ? decodeFileDone(plain)?.rseq : decodeRseqOnly(plain);
    if (!rseq) return [];
    // Acknowledge even duplicates: our previous ack may have been lost.
    this.ackDueAt = Math.min(this.ackDueAt, this.now() + this.ackDelay());
    if (m.received.has(rseq)) return [];
    m.received.add(rseq);
    while (m.received.has(m.contiguous + 1)) m.contiguous++;

    if (kind === LinkKind.Chat) {
      const c = decodeChat(plain)!;
      return [{ kind: "message", from, name: m.name, text: c.text, rseq, at: this.now() }];
    }
    if (kind === LinkKind.FileDone) {
      return [{ kind: "file_done", from, transferId: hex(decodeFileDone(plain)!.transferId) }];
    }
    // Leave
    this.members.delete(from);
    const events: RoomEvent[] = [{ kind: "left", id: from, name: m.name }];
    if (this.role === "host") {
      this.epoch = (this.epoch + 1) & 0xff;
      this.membersDue = this.others().length > 0;
    }
    // Messages waiting only for the member who left are now delivered.
    for (const o of this.outgoing.values()) if (o.status === "pending" && o.kind !== LinkKind.Leave) events.push(...this.updateDelivery(o));
    await this.recomputeCode();
    events.push(this.membersEvent());
    return events;
  }
}
