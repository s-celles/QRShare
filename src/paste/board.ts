/**
 * The paste board: an in-memory, grow-only set of signed pastes shared by the
 * peers of a room (REQ-PASTE-013 to 016, 036 to 038, 050 to 055, 061, 070 to 076,
 * 084, 085). Nothing is ever written to storage: the board lives as long as a
 * connected peer holds it.
 *
 * Inbound pipeline per frame: size check → per-peer budget → ignored-peer check
 * (all before decryption) → decrypt → parse → handler, processed one frame at a
 * time. Decrypt, parse, room-tag, signature, proof and attachment-hash failures
 * count strikes against the sending peer; cap refusals do not.
 */
import { Emitter } from "@/collab/core/emitter";
import { toArrayBuffer } from "@/collab/core/room";
import type { PeerKey } from "@/collab/core/offline/peers";
import { sanitizeFilename } from "./attachments/filename";
import {
  ACTION_BLOB,
  ACTION_CONTROL,
  FrameType,
  MAX_IDS_PER_FRAME,
  MAX_PROOF_BYTES,
  actionOf,
  compareBytes,
  decodeBlob,
  decodeDigest,
  decodeIdList,
  decodeProof,
  encodeBlob,
  encodeDigest,
  encodeIdList,
  encodeProof,
  frameSizeOk,
  openFrame,
  sealFrame,
  type PasteAction,
} from "./frames";
import { describeAuthor, fromHex, toHex, type RoomKeys } from "./keys";
import { attestationCounts, mergeOtsFiles, parseOtsFile, proofSummary, serializeOtsFile, type OtsFile } from "./ots/file";
import { isAllowedCalendar } from "./ots/calendar";
import { signSharedProof, verifySharedProof } from "./proof-share";
import {
  MAX_ATTACHMENTS,
  StatementError,
  encodeStatement,
  normalizeSource,
  openItem,
  pasteIdOf,
  sealItem,
  utf8Length,
  type AttachmentRef,
  type PasteFormat,
  type StatementFields,
} from "./statement";

/** The part of a trystero room the board needs; sends may target one peer. */
export interface PasteRoom {
  makeAction(
    namespace: string,
  ): [(data: ArrayBuffer, target?: string | null) => unknown, (fn: (data: ArrayBuffer, peerId: string) => void) => void, ...unknown[]];
  onPeerJoin(fn: (peerId: string) => void): void;
  onPeerLeave(fn: (peerId: string) => void): void;
}

export interface Paste {
  /** SHA-256 of the statement. */
  id: Uint8Array;
  statement: Uint8Array;
  signature: Uint8Array;
  author: Uint8Array;
  /** 8 hex digits of SHA-256(public key). */
  authorFp: string;
  authorName: string;
  authorColor: string;
  /** Declared by the author's device clock (unverified), ms. */
  declaredAt: number;
  /** This device's clock when the paste was accepted. */
  receivedAt: number;
  format: PasteFormat;
  source: string;
  sourceHash: Uint8Array;
  attachments: AttachmentRef[];
  own: boolean;
  /** Declared more than 5 minutes ahead of this device's clock (REQ-PASTE-015). */
  future: boolean;
  /**
   * This device's view of the `.ots` proof of the statement: the proof shared by the
   * author merged with this device's own stamp (shown, downloaded, exported, upgraded).
   */
  proof?: Uint8Array;
  /** The latest proof signed by the author: the only proof relayed to other peers (REQ-PASTE-084). */
  sharedProof?: { ots: Uint8Array; signature: Uint8Array };
  /** Where `proof` comes from: the author's shared proof, this device's own stamp, or both. */
  proofSource: "none" | "author" | "local" | "both";
  proofStatus: "none" | "pending" | "bitcoin";
}

export interface PreparedAttachment {
  bytes: Uint8Array;
  mime: string;
  name: string;
  width: number;
  height: number;
}

export type PostError = "too-large" | "too-many-attachments" | "rate" | "full";

export interface BoardLimits {
  maxPastes: number;
  maxTextBytes: number;
  maxAttachmentBytes: number;
  maxPastesPerAuthor: number;
  maxAttachmentBytesPerAuthor: number;
  postIntervalMs: number;
  /** Outbound budget of ITEM/PROOF replies per peer (REQ-PASTE-075). */
  replyBytesBurst: number;
  replyBytesPerSecond: number;
}

export const DEFAULT_LIMITS: BoardLimits = {
  maxPastes: 500,
  maxTextBytes: 4 * 1024 * 1024,
  maxAttachmentBytes: 32 * 1024 * 1024,
  maxPastesPerAuthor: 50,
  maxAttachmentBytesPerAuthor: 8 * 1024 * 1024,
  postIntervalMs: 3_000,
  replyBytesBurst: 8 * 1024 * 1024,
  replyBytesPerSecond: 1024 * 1024,
};

const CONTROL_BURST = 200;
const CONTROL_PER_SECOND = 20;
const BLOB_BURST = 10 * 1024 * 1024;
/** Inbound ITEM and PROOF frames (late joins) have a byte budget of their own. */
const CONTENT_BURST = 8 * 1024 * 1024;
const CONTENT_PER_SECOND = 1024 * 1024;
/** Received proofs are refused beyond these counts (REQ-PASTE-084). */
const MAX_PROOF_ATTESTATIONS = 32;
const MAX_PROOF_CALENDARS = 8;
const MAX_PROOF_BITCOIN = 8;

function withinProofLimits(file: OtsFile): boolean {
  const c = attestationCounts(file);
  return c.attestations <= MAX_PROOF_ATTESTATIONS && c.calendars <= MAX_PROOF_CALENDARS && c.bitcoin <= MAX_PROOF_BITCOIN;
}
const NONCE_MEMORY = 4096;
const BLOB_PER_SECOND = 2 * 1024 * 1024;
const MAX_REQUESTS_IN_FLIGHT = 4;
const MAX_STRIKES = 5;
const DIGEST_INTERVAL_MS = 20_000;
const BLOB_TIMEOUT_MS = 15_000;
const WANT_RETRY_MS = 15_000;
const FUTURE_MS = 5 * 60_000;

export interface BoardOptions {
  keys: RoomKeys;
  /** Ephemeral session key of this participant. */
  author: PeerKey;
  now?: () => number;
  /** Run `tick()` every second (default true; tests drive it by hand). */
  autoTick?: boolean;
  limits?: Partial<BoardLimits>;
}

/** Token bucket refilled continuously from an injected clock. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  take(n: number, now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (n > this.tokens) return false;
    this.tokens -= n;
    return true;
  }
}

interface PeerState {
  strikes: number;
  control: TokenBucket;
  content: TokenBucket;
  blob: TokenBucket;
  /** Outbound ITEM/PROOF replies. */
  reply: TokenBucket;
  /** Attachment answers being sent to this peer. */
  serving: number;
  /** Paste ids sent to this peer in a WANT reply, with the time. */
  sent: Map<string, number>;
  /** Nonces of recent frames (duplicates through several strategies, replays). */
  nonces: Set<string>;
}

/** A paste id requested from `peer`; other peers that advertised it are fallbacks. */
interface WantedId {
  at: number;
  peer: string;
  advertisers: Set<string>;
  tried: Set<string>;
}

interface Entry {
  paste: Paste;
  /** Peers known to hold the paste. */
  holders: Set<string>;
  /** Union of the proofs signed by the author (shared, relayed through `paste.sharedProof`). */
  sharedUnion?: Uint8Array;
  /** This device's own stamp of someone else's paste: never broadcast. */
  localProof?: Uint8Array;
}

interface BlobRequest {
  peer?: string;
  sentAt: number;
  tried: Set<string>;
  unavailable: boolean;
}

type Events = { change: Paste[]; peers: number; ignored: number; full: boolean; blobs: void };

const sameBytes = (a: Uint8Array, b: Uint8Array) => compareBytes(a, b) === 0;

function normalizeMime(mime: string): string {
  const token = mime.split(";")[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/.test(token) ? token : "application/octet-stream";
}

export class PasteBoard extends Emitter<Events> {
  private readonly entries = new Map<string, Entry>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly requests = new Map<string, BlobRequest>();
  private readonly wanted = new Map<string, WantedId>();
  private readonly peers = new Set<string>();
  private readonly peerStates = new Map<string, PeerState>();
  private readonly ignored = new Set<string>();
  private readonly perAuthor = new Map<string, { count: number; bytes: number }>();
  /** Attachments refused because the board's attachment budget is spent. */
  private readonly refusedBlobs = new Set<string>();
  private readonly limits: BoardLimits;
  private readonly now: () => number;
  private readonly sendControl: (data: ArrayBuffer, target?: string | null) => unknown;
  private readonly sendBlob: (data: ArrayBuffer, target?: string | null) => unknown;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private textBytes = 0;
  private attachmentBytes = 0;
  private full = false;
  private lastPost = -Infinity;
  private lastDigest: number;
  private digestCache: { version: number; value: Promise<Uint8Array> } | null = null;
  private version = 0;
  private destroyed = false;
  private readonly counters = { sizeDrops: 0, budgetDrops: 0, duplicateDrops: 0 };

  constructor(
    room: PasteRoom,
    private readonly opts: BoardOptions,
  ) {
    super();
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
    this.lastDigest = this.now();
    const [sendControl, onControl] = room.makeAction(ACTION_CONTROL);
    const [sendBlob, onBlob] = room.makeAction(ACTION_BLOB);
    this.sendControl = sendControl;
    this.sendBlob = sendBlob;
    onControl((data, peer) => this.inbound(ACTION_CONTROL, data, peer));
    onBlob((data, peer) => this.inbound(ACTION_BLOB, data, peer));
    room.onPeerJoin((peer) => {
      if (this.destroyed) return;
      this.peers.add(peer);
      this.emit("peers", this.peers.size);
      void this.sendInv(peer);
    });
    room.onPeerLeave((peer) => {
      if (this.destroyed) return;
      this.peers.delete(peer);
      for (const e of this.entries.values()) e.holders.delete(peer);
      for (const r of this.requests.values()) {
        if (r.peer === peer) {
          r.tried.add(peer);
          r.peer = undefined;
        }
      }
      this.emit("peers", this.peers.size);
      void this.pump();
    });
    if (opts.autoTick !== false) this.timer = setInterval(() => this.tick(), 1000);
  }

  // -------------------------------------------------------------------------
  // Public API

  /** Pastes, newest declared first, ties by id (REQ-PASTE-055). */
  pastes(): Paste[] {
    return [...this.entries.values()]
      .map((e) => e.paste)
      .sort((a, b) => b.declaredAt - a.declaredAt || compareBytes(a.id, b.id));
  }

  peerCount(): number {
    return this.peers.size;
  }

  ignoredCount(): number {
    return this.ignored.size;
  }

  isFull(): boolean {
    return this.full;
  }

  strikes(peer: string): number {
    return this.peerStates.get(peer)?.strikes ?? 0;
  }

  stats(): { sizeDrops: number; budgetDrops: number; duplicateDrops: number; wanted: number } {
    return { ...this.counters, wanted: this.wanted.size };
  }

  /** The attachment bytes, or whether they are still expected. */
  attachment(hash: Uint8Array): Uint8Array | "loading" | "unavailable" {
    const hex = toHex(hash);
    const bytes = this.blobs.get(hex);
    if (bytes) return bytes;
    if (!this.listed(hex) || this.refusedBlobs.has(hex)) return "unavailable";
    return this.requests.get(hex)?.unavailable ? "unavailable" : "loading";
  }

  async post(input: { format: PasteFormat; source: string; attachments: PreparedAttachment[] }): Promise<Paste | { error: PostError }> {
    const now = this.now();
    if (now - this.lastPost < this.limits.postIntervalMs) return { error: "rate" };
    if (input.attachments.length > MAX_ATTACHMENTS) return { error: "too-many-attachments" };
    // claimed before the first await, so that concurrent posts are rate-limited too
    const previous = this.lastPost;
    this.lastPost = now;
    const result = await this.postNow(input, now);
    if ("error" in result) this.lastPost = previous;
    return result;
  }

  private async postNow(input: { format: PasteFormat; source: string; attachments: PreparedAttachment[] }, now: number): Promise<Paste | { error: PostError }> {
    const attachments: AttachmentRef[] = await Promise.all(
      input.attachments.map(async (a) => ({
        hash: await pasteIdOf(a.bytes),
        size: a.bytes.length,
        mime: normalizeMime(a.mime),
        name: sanitizeFilename(a.name),
        width: a.width,
        height: a.height,
      })),
    );
    const fields: StatementFields = {
      tag: this.opts.keys.tag,
      author: this.opts.author.publicKey,
      declaredAt: now,
      format: input.format,
      source: normalizeSource(input.source),
      attachments,
    };
    let statement: Uint8Array;
    try {
      statement = encodeStatement(fields);
    } catch (err) {
      if (err instanceof StatementError) return { error: "too-large" };
      throw err;
    }
    const newBytes = attachments.filter((a, i) => !this.blobs.has(toHex(a.hash)) && attachments.findIndex((b) => sameBytes(b.hash, a.hash)) === i).reduce((n, a) => n + a.size, 0);
    if (this.admit(fields) !== "ok" || this.attachmentBytes + newBytes > this.limits.maxAttachmentBytes) return { error: "full" };
    const item = await sealItem(statement, this.opts.author.privateKey);
    const opened = await openItem(item, this.opts.keys.tag);
    if (this.entries.has(toHex(opened.id))) return this.entries.get(toHex(opened.id))!.paste;
    input.attachments.forEach((a, i) => this.storeBlob(toHex(attachments[i].hash), a.bytes));
    const paste = await this.store(opened, null);
    await this.broadcast(FrameType.ITEM, item);
    return paste;
  }

  /**
   * Adds a proof this device obtained (stamp or upgrade) for paste `id`.
   * - On the author's own paste, it is merged with the shared proof, signed with the
   *   author key and shared with the room ("shared"); when the union would be too large,
   *   the new proof replaces the shared one ("replaced").
   * - On someone else's paste, it stays on this device ("local"): only authors share.
   */
  async attachProof(id: Uint8Array, ots: Uint8Array): Promise<"shared" | "replaced" | "local" | "invalid"> {
    const entry = this.entries.get(toHex(id));
    if (!entry) return "invalid";
    const incoming = await this.validProof(entry.paste, ots);
    if (!incoming) return "invalid";
    const held = entry.paste.own ? entry.sharedUnion : entry.localProof;
    let union = held ? await this.union(held, ots) : ots;
    const replaced = union === null;
    if (union === null) union = ots;
    if (!entry.paste.own) {
      entry.localProof = union;
      await this.recompute(entry);
      return "local";
    }
    if (held && sameBytes(held, union)) return "shared";
    const signature = await signSharedProof(this.opts.author.privateKey, this.opts.keys.tag, entry.paste.id, union);
    entry.sharedUnion = union;
    entry.paste.sharedProof = { ots: union, signature };
    await this.recompute(entry);
    await this.broadcast(FrameType.PROOF, encodeProof(entry.paste.id, signature, union));
    return replaced ? "replaced" : "shared";
  }

  /** Accepts an ITEM plaintext (statement ‖ signature) received from `peer`. Throws StatementError when invalid. */
  async receiveItem(item: Uint8Array, peer: string): Promise<"accepted" | "duplicate" | "refused"> {
    const opened = await openItem(item, this.opts.keys.tag);
    const hex = toHex(opened.id);
    this.wanted.delete(hex);
    const known = this.entries.get(hex);
    if (known) {
      known.holders.add(peer);
      return "duplicate";
    }
    if (this.admit(opened.fields) !== "ok") return "refused";
    await this.store(opened, peer);
    return "accepted";
  }

  /** Periodic work: digest every 20 s, attachment request time-outs. */
  tick(): void {
    if (this.destroyed) return;
    const now = this.now();
    if (now - this.lastDigest >= DIGEST_INTERVAL_MS) {
      this.lastDigest = now;
      void this.digest().then((hash) => this.broadcast(FrameType.DIGEST, encodeDigest(Math.min(this.entries.size, 65535), hash)));
    }
    this.expireWanted(now);
    void this.pump();
  }

  /** Drops the board, attachments and proofs from memory (REQ-PASTE-007). */
  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.entries.clear();
    this.blobs.clear();
    this.requests.clear();
    this.wanted.clear();
    this.peers.clear();
    this.peerStates.clear();
    this.perAuthor.clear();
    this.refusedBlobs.clear();
    this.clear();
  }

  // -------------------------------------------------------------------------
  // Storage and caps

  private admit(fields: StatementFields): "ok" | "full" | "author" {
    const authorHex = toHex(fields.author);
    const author = this.perAuthor.get(authorHex) ?? { count: 0, bytes: 0 };
    const pasteBytes = fields.attachments.reduce((n, a) => n + a.size, 0);
    // attachment bytes count against the board only when they arrive (storeBlob)
    if (this.entries.size >= this.limits.maxPastes || this.textBytes + utf8Length(fields.source) > this.limits.maxTextBytes) {
      if (!this.full) {
        this.full = true;
        this.emit("full", true);
      }
      return "full";
    }
    if (author.count >= this.limits.maxPastesPerAuthor || author.bytes + pasteBytes > this.limits.maxAttachmentBytesPerAuthor) return "author";
    return "ok";
  }

  private async store(opened: Awaited<ReturnType<typeof openItem>>, from: string | null): Promise<Paste> {
    const { fields } = opened;
    const view = await describeAuthor(fields.author);
    const receivedAt = this.now();
    const own = sameBytes(fields.author, this.opts.author.publicKey);
    const paste: Paste = {
      id: opened.id,
      statement: opened.statement,
      signature: opened.signature,
      author: fields.author,
      authorFp: view.fingerprint,
      authorName: view.identity.name,
      authorColor: view.identity.color,
      declaredAt: fields.declaredAt,
      receivedAt,
      format: fields.format,
      source: fields.source,
      sourceHash: await pasteIdOf(new TextEncoder().encode(fields.source)),
      attachments: fields.attachments,
      own,
      future: !own && fields.declaredAt - receivedAt > FUTURE_MS,
      proofSource: "none",
      proofStatus: "none",
    };
    const hex = toHex(opened.id);
    this.entries.set(hex, { paste, holders: new Set(from ? [from] : []) });
    this.textBytes += utf8Length(fields.source);
    const authorHex = toHex(fields.author);
    const author = this.perAuthor.get(authorHex) ?? { count: 0, bytes: 0 };
    this.perAuthor.set(authorHex, { count: author.count + 1, bytes: author.bytes + fields.attachments.reduce((n, a) => n + a.size, 0) });
    this.wanted.delete(hex);
    this.changed();
    if (fields.attachments.some((a) => !this.blobs.has(toHex(a.hash)))) void this.pump();
    return paste;
  }

  /** Keeps attachment bytes within the board budget (REQ-PASTE-072); false when refused. */
  private storeBlob(hex: string, bytes: Uint8Array): boolean {
    if (this.blobs.has(hex)) return true;
    if (this.attachmentBytes + bytes.length > this.limits.maxAttachmentBytes) {
      this.refusedBlobs.add(hex);
      this.requests.delete(hex);
      if (!this.full) {
        this.full = true;
        this.emit("full", true);
      }
      return false;
    }
    this.blobs.set(hex, bytes);
    this.attachmentBytes += bytes.length;
    return true;
  }

  /**
   * Requests older than the retry delay go to another connected peer that advertised
   * the id, or are forgotten. Non-delivery is never a strike: a slow link or a busy peer
   * (outbound budget, 15 s no-resend window) is not misbehaving.
   */
  private expireWanted(now: number): void {
    const batches = new Map<string, Uint8Array[]>();
    for (const [hex, w] of this.wanted) {
      if (now - w.at < WANT_RETRY_MS) continue;
      w.tried.add(w.peer);
      const next = [...w.advertisers].find((p) => !w.tried.has(p) && this.peers.has(p) && !this.ignored.has(p));
      if (!next) {
        this.wanted.delete(hex);
        continue;
      }
      w.peer = next;
      w.at = now;
      batches.set(next, [...(batches.get(next) ?? []), fromHex(hex)!]);
    }
    for (const [peer, ids] of batches) void this.send(FrameType.WANT, encodeIdList(ids), peer);
  }

  private changed(): void {
    this.version++;
    this.emit("change", this.pastes());
  }

  private digest(): Promise<Uint8Array> {
    if (this.digestCache?.version !== this.version) {
      const ids = [...this.entries.values()].map((e) => e.paste.id);
      this.digestCache = { version: this.version, value: pasteIdOf(encodeIdList(ids)) };
    }
    return this.digestCache.value;
  }

  private listed(hashHex: string): AttachmentRef | undefined {
    for (const { paste } of this.entries.values()) {
      const ref = paste.attachments.find((a) => toHex(a.hash) === hashHex);
      if (ref) return ref;
    }
    return undefined;
  }

  /**
   * The parsed proof when it is acceptable for `paste`: digest = paste id, within the
   * size and attestation limits, at least one attestation, only allow-listed calendars,
   * no unknown attestation or unsupported operation.
   */
  private async validProof(paste: Paste, ots: Uint8Array): Promise<OtsFile | null> {
    try {
      const file = await parseOtsFile(ots, MAX_PROOF_BYTES);
      const summary = proofSummary(file);
      if (!sameBytes(file.digest, paste.id) || !withinProofLimits(file) || summary.status === "none") return null;
      if (summary.unsupported || !summary.calendars.every(isAllowedCalendar)) return null;
      return file;
    } catch {
      return null;
    }
  }

  /** Union of two proofs (never pruned), or null when it would exceed the limits. */
  private async union(a: Uint8Array, b: Uint8Array): Promise<Uint8Array | null> {
    const file = mergeOtsFiles(await parseOtsFile(a, Infinity), await parseOtsFile(b, Infinity));
    const bytes = serializeOtsFile(file);
    return bytes.length > MAX_PROOF_BYTES || !withinProofLimits(file) ? null : bytes;
  }

  /** This device's view of the proof: the author's shared proof merged with its own stamp. */
  private async recompute(entry: Entry): Promise<void> {
    const { paste, sharedUnion, localProof } = entry;
    let view = sharedUnion ?? localProof;
    if (sharedUnion && localProof) {
      const file = mergeOtsFiles(await parseOtsFile(sharedUnion, Infinity), await parseOtsFile(localProof, Infinity));
      view = serializeOtsFile(file);
    }
    paste.proof = view;
    paste.proofSource = sharedUnion && localProof ? "both" : sharedUnion ? "author" : localProof ? "local" : "none";
    paste.proofStatus = !view ? "none" : proofSummary(await parseOtsFile(view, Infinity)).status === "bitcoin" ? "bitcoin" : "pending";
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Network

  private async send(type: FrameType, plaintext: Uint8Array, target: string | null): Promise<void> {
    if (this.destroyed) return;
    const frame = await sealFrame(this.opts.keys.contentKey, type, plaintext);
    const send = actionOf(type) === ACTION_BLOB ? this.sendBlob : this.sendControl;
    try {
      await send(toArrayBuffer(frame), target);
    } catch {
      /* a failed send is retried by the periodic sync */
    }
  }

  private broadcast(type: FrameType, plaintext: Uint8Array): Promise<void> {
    return this.send(type, plaintext, null);
  }

  private async sendInv(peer: string): Promise<void> {
    const ids = [...this.entries.values()].map((e) => e.paste.id);
    for (let i = 0; i < Math.max(1, ids.length); i += MAX_IDS_PER_FRAME) {
      await this.send(FrameType.INV, encodeIdList(ids.slice(i, i + MAX_IDS_PER_FRAME)), peer);
    }
  }

  private peerState(peer: string): PeerState {
    let s = this.peerStates.get(peer);
    if (!s) {
      const now = this.now();
      s = {
        strikes: 0,
        control: new TokenBucket(CONTROL_BURST, CONTROL_PER_SECOND, now),
        content: new TokenBucket(CONTENT_BURST, CONTENT_PER_SECOND, now),
        blob: new TokenBucket(BLOB_BURST, BLOB_PER_SECOND, now),
        reply: new TokenBucket(this.limits.replyBytesBurst, this.limits.replyBytesPerSecond, now),
        serving: 0,
        sent: new Map(),
        nonces: new Set(),
      };
      this.peerStates.set(peer, s);
    }
    return s;
  }

  private strike(peer: string): void {
    const s = this.peerState(peer);
    s.strikes++;
    if (s.strikes >= MAX_STRIKES && !this.ignored.has(peer)) {
      this.ignored.add(peer);
      this.emit("ignored", this.ignored.size);
    }
  }

  private inbound(action: PasteAction, data: unknown, peer: string): void {
    if (this.destroyed) return;
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
    if (!bytes || !frameSizeOk(action, bytes.length)) {
      this.counters.sizeDrops++;
      return;
    }
    if (this.ignored.has(peer)) return;
    const s = this.peerState(peer);
    // the same frame through several strategies (or a replay): same random nonce
    const nonce = `${action}:${toHex(bytes.subarray(0, 14))}`;
    if (s.nonces.has(nonce)) {
      this.counters.duplicateDrops++;
      return;
    }
    s.nonces.add(nonce);
    if (s.nonces.size > NONCE_MEMORY) s.nonces.delete(s.nonces.values().next().value!);
    const now = this.now();
    // the type byte is readable (authenticated) before decryption
    const content = bytes[1] === FrameType.ITEM || bytes[1] === FrameType.PROOF;
    const bucket = action === ACTION_BLOB ? s.blob : content ? s.content : s.control;
    if (!bucket.take(action === ACTION_BLOB || content ? bytes.length : 1, now)) {
      this.counters.budgetDrops++;
      return;
    }
    this.queue = this.queue.then(() => this.handle(action, bytes, peer)).catch(() => undefined);
  }

  private async handle(action: PasteAction, bytes: Uint8Array, peer: string): Promise<void> {
    if (this.destroyed || this.ignored.has(peer)) return;
    const frame = await openFrame(this.opts.keys.contentKey, bytes);
    if (!frame || actionOf(frame.type) !== action) return this.strike(peer);
    const p = frame.plaintext;
    switch (frame.type) {
      case FrameType.INV: {
        const ids = decodeIdList(p);
        if (!ids) return this.strike(peer);
        const want: Uint8Array[] = [];
        const now = this.now();
        // never more requests than free places on the board (REQ-PASTE-072), and each
        // connected peer gets its share of them, so one peer cannot take every slot
        const free = this.limits.maxPastes - this.entries.size;
        let room = free - this.wanted.size;
        let share = Math.max(1, Math.floor(free / Math.max(1, this.peers.size))) - [...this.wanted.values()].filter((w) => w.peer === peer).length;
        for (const id of ids) {
          const hex = toHex(id);
          const entry = this.entries.get(hex);
          const pending = this.wanted.get(hex);
          if (entry) entry.holders.add(peer);
          else if (pending) pending.advertisers.add(peer); // asked elsewhere: a fallback if that request expires
          else if (room > 0 && share > 0) {
            this.wanted.set(hex, { at: now, peer, advertisers: new Set([peer]), tried: new Set() });
            want.push(id);
            room--;
            share--;
          }
        }
        if (want.length) await this.send(FrameType.WANT, encodeIdList(want), peer);
        await this.pump();
        return;
      }
      case FrameType.WANT: {
        const ids = decodeIdList(p);
        if (!ids) return this.strike(peer);
        const s = this.peerState(peer);
        const now = this.now();
        for (const hex of new Set(ids.map(toHex))) {
          const entry = this.entries.get(hex);
          if (!entry || now - (s.sent.get(hex) ?? -Infinity) < WANT_RETRY_MS) continue;
          const { paste } = entry;
          const item = new Uint8Array([...paste.statement, ...paste.signature]);
          // only the author-signed proof travels, never this device's own stamp
          const proof = paste.sharedProof ? encodeProof(paste.id, paste.sharedProof.signature, paste.sharedProof.ots) : null;
          // replies are paced by an outbound budget; the rest is asked again later
          if (!s.reply.take(item.length + (proof?.length ?? 0), now)) break;
          s.sent.set(hex, now);
          await this.send(FrameType.ITEM, item, peer);
          if (proof) await this.send(FrameType.PROOF, proof, peer);
        }
        return;
      }
      case FrameType.ITEM: {
        try {
          await this.receiveItem(p, peer);
        } catch {
          this.strike(peer);
        }
        return;
      }
      case FrameType.PROOF: {
        const proof = decodeProof(p);
        if (!proof) return this.strike(peer);
        const entry = this.entries.get(toHex(proof.id));
        if (!entry) return;
        entry.holders.add(peer);
        const { paste } = entry;
        if (paste.sharedProof && sameBytes(paste.sharedProof.ots, proof.ots)) return; // relayed again
        // only the paste's author may share a proof: anything else is a forgery
        if (!(await verifySharedProof(paste.author, this.opts.keys.tag, paste.id, proof.ots, proof.signature))) return this.strike(peer);
        // signed by the author but unusable: the relaying peer is not at fault
        if (!(await this.validProof(paste, proof.ots))) return;
        const union = entry.sharedUnion ? await this.union(entry.sharedUnion, proof.ots) : proof.ots;
        if (!union) return; // too large: keep the proof held, no strike
        if (entry.sharedUnion && sameBytes(entry.sharedUnion, union)) return;
        entry.sharedUnion = union;
        paste.sharedProof = { ots: proof.ots, signature: proof.signature };
        await this.recompute(entry);
        // relay the author's signed proof as received, for peers not connected to the author
        await this.broadcast(FrameType.PROOF, encodeProof(paste.id, proof.signature, proof.ots));
        return;
      }
      case FrameType.DIGEST: {
        const digest = decodeDigest(p);
        if (!digest) return this.strike(peer);
        const ours = await this.digest();
        if (digest.count !== Math.min(this.entries.size, 65535) || !sameBytes(digest.hash, ours)) await this.sendInv(peer);
        return;
      }
      case FrameType.BLOB_WANT: {
        const hashes = decodeIdList(p);
        if (!hashes) return this.strike(peer);
        const s = this.peerState(peer);
        for (const hash of hashes) {
          const hex = toHex(hash);
          const bytes = this.blobs.get(hex);
          if (!bytes || !this.listed(hex) || s.serving >= MAX_REQUESTS_IN_FLIGHT) continue;
          s.serving++;
          void this.send(FrameType.BLOB, encodeBlob(hash, bytes), peer).finally(() => s.serving--);
        }
        return;
      }
      case FrameType.BLOB: {
        const blob = decodeBlob(p);
        if (!blob) return this.strike(peer);
        const hex = toHex(blob.hash);
        if (this.blobs.has(hex)) return;
        const ref = this.listed(hex);
        if (!ref) return;
        if (blob.bytes.length !== ref.size || toHex(await pasteIdOf(blob.bytes)) !== hex) return this.strike(peer);
        if (this.refusedBlobs.has(hex)) return;
        this.storeBlob(hex, blob.bytes);
        this.requests.delete(hex);
        this.emit("blobs", undefined);
        await this.pump();
        return;
      }
    }
  }

  /** Requests missing attachments: the paste's sender first, then other holders (REQ-PASTE-036). */
  private async pump(): Promise<void> {
    if (this.destroyed) return;
    const now = this.now();
    const inFlight = new Map<string, number>();
    for (const r of this.requests.values()) if (r.peer) inFlight.set(r.peer, (inFlight.get(r.peer) ?? 0) + 1);
    const batches = new Map<string, Uint8Array[]>();
    let changed = false;
    for (const { paste } of this.entries.values()) {
      for (const ref of paste.attachments) {
        const hex = toHex(ref.hash);
        if (this.blobs.has(hex) || this.refusedBlobs.has(hex)) continue;
        let r = this.requests.get(hex);
        if (!r) {
          r = { sentAt: 0, tried: new Set(), unavailable: false };
          this.requests.set(hex, r);
        }
        if (r.peer && now - r.sentAt < BLOB_TIMEOUT_MS) continue;
        if (r.peer) {
          r.tried.add(r.peer);
          inFlight.set(r.peer, (inFlight.get(r.peer) ?? 1) - 1);
          r.peer = undefined;
        }
        const holders = [...this.entries.values()]
          .filter((e) => e.paste.attachments.some((a) => toHex(a.hash) === hex))
          .flatMap((e) => [...e.holders])
          .filter((p) => this.peers.has(p) && !this.ignored.has(p) && !r.tried.has(p));
        const peer = holders.find((p) => (inFlight.get(p) ?? 0) < MAX_REQUESTS_IN_FLIGHT);
        if (peer) {
          r.peer = peer;
          r.sentAt = now;
          if (r.unavailable) changed = true;
          r.unavailable = false;
          inFlight.set(peer, (inFlight.get(peer) ?? 0) + 1);
          batches.set(peer, [...(batches.get(peer) ?? []), ref.hash]);
        } else if (!holders.length && !r.unavailable) {
          r.unavailable = true;
          changed = true;
        }
      }
    }
    if (changed) this.emit("blobs", undefined);
    for (const [peer, hashes] of batches) await this.send(FrameType.BLOB_WANT, encodeIdList(hashes), peer);
  }
}
