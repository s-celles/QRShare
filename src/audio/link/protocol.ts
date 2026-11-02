/**
 * Payloads of audio session (link) packets (REQ-ALS-001..017, 032).
 * The clear header is encoded by `packet.ts` (`encodeLinkBody`); BEACON and JOIN
 * payloads travel in clear, WELCOME under the pairwise key, the others under the
 * group key (see `crypto.ts`). All integers big-endian.
 */

import type { MemberEntry } from "./crypto";

export const LinkKind = {
  Beacon: 1,
  Join: 2,
  Welcome: 3,
  Members: 4,
  Chat: 5,
  Presence: 6,
  Leave: 7,
  FileDone: 8,
} as const;
export type LinkKindValue = (typeof LinkKind)[keyof typeof LinkKind];

/** Longest chat message (UTF-8 bytes) sent in one packet. */
export const MAX_CHAT_BYTES = 180;
const MAX_NAME_BYTES = 40;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

/** Whole code points of `s` within `max` UTF-8 bytes. */
export function clipUtf8(s: string, max: number): Uint8Array {
  let out = "";
  let used = 0;
  for (const cp of s) {
    const n = enc.encode(cp).length;
    if (used + n > max) break;
    out += cp;
    used += n;
  }
  return enc.encode(out);
}

class Writer {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  u32(v: number) { this.parts.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
  bytes(b: Uint8Array) { for (const x of b) this.parts.push(x); return this; }
  str(s: string, max: number) { const b = clipUtf8(s, max); return this.u8(b.length).bytes(b); }
  done(): Uint8Array { return Uint8Array.from(this.parts); }
}

class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  private need(n: number) { if (this.o + n > this.b.length) throw new Error("short"); }
  u8() { this.need(1); return this.b[this.o++]; }
  u32() { this.need(4); const v = ((this.b[this.o] << 24) | (this.b[this.o + 1] << 16) | (this.b[this.o + 2] << 8) | this.b[this.o + 3]) >>> 0; this.o += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.b.slice(this.o, this.o + n); this.o += n; return v; }
  str() { return dec.decode(this.bytes(this.u8())); }
  rest() { const v = this.b.slice(this.o); this.o = this.b.length; return v; }
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

export interface Beacon { publicRaw: Uint8Array; profileIndex: number; name: string }
export const encodeBeacon = (b: Beacon) => new Writer().bytes(b.publicRaw).u8(b.profileIndex).str(b.name, MAX_NAME_BYTES).done();
export const decodeBeacon = (p: Uint8Array): Beacon | null =>
  safe(() => { const r = new Reader(p); return { publicRaw: r.bytes(65), profileIndex: r.u8(), name: r.str() }; });

export interface Join { publicRaw: Uint8Array; name: string }
export const encodeJoin = (j: Join) => new Writer().bytes(j.publicRaw).str(j.name, MAX_NAME_BYTES).done();
export const decodeJoin = (p: Uint8Array): Join | null => safe(() => { const r = new Reader(p); return { publicRaw: r.bytes(65), name: r.str() }; });

function writeMembers(w: Writer, members: readonly MemberEntry[]) {
  w.u8(members.length);
  for (const m of members) w.u32(m.id).bytes(m.fp);
}
function readMembers(r: Reader): MemberEntry[] {
  const n = r.u8();
  const out: MemberEntry[] = [];
  for (let i = 0; i < n; i++) out.push({ id: r.u32(), fp: r.bytes(8) });
  return out;
}

export interface Welcome { target: number; epoch: number; groupKey: Uint8Array; members: MemberEntry[] }
export function encodeWelcome(w: Welcome): Uint8Array {
  const out = new Writer().u32(w.target).u8(w.epoch).bytes(w.groupKey);
  writeMembers(out, w.members);
  return out.done();
}
export const decodeWelcome = (p: Uint8Array): Welcome | null =>
  safe(() => { const r = new Reader(p); return { target: r.u32(), epoch: r.u8(), groupKey: r.bytes(32), members: readMembers(r) }; });

export interface Members { epoch: number; members: MemberEntry[] }
export function encodeMembers(m: Members): Uint8Array {
  const out = new Writer().u8(m.epoch);
  writeMembers(out, m.members);
  return out.done();
}
export const decodeMembers = (p: Uint8Array): Members | null => safe(() => { const r = new Reader(p); return { epoch: r.u8(), members: readMembers(r) }; });

export interface Chat { rseq: number; text: string }
export const encodeChat = (c: Chat) => new Writer().u32(c.rseq).bytes(clipUtf8(c.text, MAX_CHAT_BYTES)).done();
export const decodeChat = (p: Uint8Array): Chat | null => safe(() => { const r = new Reader(p); return { rseq: r.u32(), text: dec.decode(r.rest()) }; });

export interface Presence { name: string; acks: { id: number; rseq: number }[] }
export function encodePresence(p: Presence): Uint8Array {
  const w = new Writer().str(p.name, MAX_NAME_BYTES).u8(p.acks.length);
  for (const a of p.acks) w.u32(a.id).u32(a.rseq);
  return w.done();
}
export const decodePresence = (p: Uint8Array): Presence | null =>
  safe(() => {
    const r = new Reader(p);
    const name = r.str();
    const n = r.u8();
    const acks: { id: number; rseq: number }[] = [];
    for (let i = 0; i < n; i++) acks.push({ id: r.u32(), rseq: r.u32() });
    return { name, acks };
  });

export const encodeRseqOnly = (rseq: number) => new Writer().u32(rseq).done();
export const decodeRseqOnly = (p: Uint8Array): number | null => safe(() => new Reader(p).u32());

export interface FileDone { rseq: number; transferId: Uint8Array }
export const encodeFileDone = (f: FileDone) => new Writer().u32(f.rseq).bytes(f.transferId).done();
export const decodeFileDone = (p: Uint8Array): FileDone | null => safe(() => { const r = new Reader(p); return { rseq: r.u32(), transferId: r.bytes(4) }; });
