/**
 * OpenTimestamps commitment trees (same serialisation as python-opentimestamps).
 *
 * A node holds the message it commits to, its attestations and the operations
 * leading to child nodes. SHA-256, append and prepend are supported; SHA-1,
 * RIPEMD-160, Keccak-256, reverse and hexlify are parsed but their results are not
 * computed (the subtree's messages are null, reported as unsupported, REQ-PASTE-094).
 */
import { OtsError, Reader, Writer } from "./varint";

export type Op =
  | { kind: "sha256" }
  | { kind: "append"; arg: Uint8Array }
  | { kind: "prepend"; arg: Uint8Array }
  | { kind: "unsupported"; tag: number; name: string };

export type Attestation =
  | { kind: "pending"; uri: string }
  | { kind: "bitcoin"; height: number }
  | { kind: "unknown"; tag: Uint8Array; payload: Uint8Array };

export interface Branch {
  op: Op;
  stamp: Timestamp;
}

export class Timestamp {
  attestations: Attestation[] = [];
  readonly ops = new Map<string, Branch>();
  constructor(public msg: Uint8Array | null) {}
}

export const MAX_MSG_LENGTH = 4096;
export const MAX_DEPTH = 256;
const MAX_PAYLOAD = 8192;
const MAX_URI = 1000;
export const PENDING_TAG = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
export const BITCOIN_TAG = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
const URI_CHARS = /^[A-Za-z0-9\-._/:]*$/;
const UNSUPPORTED: Record<number, string> = { 0x02: "SHA-1", 0x03: "RIPEMD-160", 0x67: "Keccak-256", 0xf2: "reverse", 0xf3: "hexlify" };

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => compareBytes(a, b) === 0;

export function opTag(op: Op): number {
  switch (op.kind) {
    case "sha256":
      return 0x08;
    case "append":
      return 0xf0;
    case "prepend":
      return 0xf1;
    default:
      return op.tag;
  }
}

function opKey(op: Op): string {
  return op.kind === "append" || op.kind === "prepend" ? `${opTag(op)}:${hex(op.arg)}` : String(opTag(op));
}

function compareOps(a: Op, b: Op): number {
  const t = opTag(a) - opTag(b);
  if (t) return t;
  return "arg" in a && "arg" in b ? compareBytes(a.arg, b.arg) : 0;
}

function attestationTag(a: Attestation): Uint8Array {
  return a.kind === "pending" ? PENDING_TAG : a.kind === "bitcoin" ? BITCOIN_TAG : a.tag;
}

function attestationKey(a: Attestation): string {
  if (a.kind === "pending") return `p:${a.uri}`;
  if (a.kind === "bitcoin") return `b:${a.height}`;
  return `u:${hex(a.tag)}:${hex(a.payload)}`;
}

function compareAttestations(a: Attestation, b: Attestation): number {
  const t = compareBytes(attestationTag(a), attestationTag(b));
  if (t || a.kind !== b.kind) return t;
  if (a.kind === "pending" && b.kind === "pending") return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  if (a.kind === "bitcoin" && b.kind === "bitcoin") return a.height - b.height;
  if (a.kind === "unknown" && b.kind === "unknown") return compareBytes(a.payload, b.payload);
  return 0;
}

function addAttestation(stamp: Timestamp, a: Attestation): void {
  const key = attestationKey(a);
  if (!stamp.attestations.some((x) => attestationKey(x) === key)) stamp.attestations.push(a);
}

// ---------------------------------------------------------------------------
// Operations

async function sha256(msg: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", msg as Uint8Array<ArrayBuffer>));
}

/** The result of `op` on `msg`, or null when the operation is not supported. */
export async function applyOp(op: Op, msg: Uint8Array): Promise<Uint8Array | null> {
  if (msg.length > MAX_MSG_LENGTH) throw new OtsError("Message too long");
  let out: Uint8Array;
  switch (op.kind) {
    case "sha256":
      return sha256(msg);
    case "append":
      out = new Uint8Array(msg.length + op.arg.length);
      out.set(msg);
      out.set(op.arg, msg.length);
      break;
    case "prepend":
      out = new Uint8Array(msg.length + op.arg.length);
      out.set(op.arg);
      out.set(msg, op.arg.length);
      break;
    default:
      return null;
  }
  if (out.length > MAX_MSG_LENGTH) throw new OtsError("Result too long");
  return out;
}

/** Adds (or finds) the branch `op` under `stamp` and returns its child. */
export async function addOp(stamp: Timestamp, op: Op): Promise<Timestamp> {
  const key = opKey(op);
  const known = stamp.ops.get(key);
  if (known) return known.stamp;
  const child = new Timestamp(stamp.msg ? await applyOp(op, stamp.msg) : null);
  stamp.ops.set(key, { op, stamp: child });
  return child;
}

// ---------------------------------------------------------------------------
// Parsing

function readAttestation(r: Reader): Attestation {
  const tag = r.take(8);
  const payload = r.varbytes(MAX_PAYLOAD);
  const p = new Reader(payload);
  if (equalBytes(tag, PENDING_TAG)) {
    const uri = new TextDecoder().decode(p.varbytes(MAX_URI));
    if (!URI_CHARS.test(uri)) throw new OtsError("Invalid calendar URI");
    if (!p.atEnd()) throw new OtsError("Trailing bytes in attestation");
    return { kind: "pending", uri };
  }
  if (equalBytes(tag, BITCOIN_TAG)) {
    const height = p.varuint();
    if (!p.atEnd()) throw new OtsError("Trailing bytes in attestation");
    return { kind: "bitcoin", height };
  }
  return { kind: "unknown", tag, payload };
}

function readOp(r: Reader, tag: number): Op {
  if (tag === 0x08) return { kind: "sha256" };
  if (tag === 0xf0) return { kind: "append", arg: r.varbytes(MAX_MSG_LENGTH, 1) };
  if (tag === 0xf1) return { kind: "prepend", arg: r.varbytes(MAX_MSG_LENGTH, 1) };
  const name = UNSUPPORTED[tag];
  if (name) return { kind: "unsupported", tag, name };
  throw new OtsError(`Unknown operation 0x${tag.toString(16)}`);
}

/** Reads a tree structure (messages are computed by `computeMessages`). */
export function readTimestamp(r: Reader, depth = MAX_DEPTH): Timestamp {
  if (depth <= 0) throw new OtsError("Proof exceeds the depth limit");
  const stamp = new Timestamp(null);
  const item = (tag: number) => {
    if (tag === 0x00) {
      addAttestation(stamp, readAttestation(r));
      return;
    }
    const op = readOp(r, tag);
    const key = opKey(op);
    if (stamp.ops.has(key)) throw new OtsError("Repeated operation");
    stamp.ops.set(key, { op, stamp: readTimestamp(r, depth - 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) {
    item(r.byte());
    tag = r.byte();
  }
  item(tag);
  return stamp;
}

/** Sets the message of every node from `msg` (null below unsupported operations). */
export async function computeMessages(stamp: Timestamp, msg: Uint8Array | null): Promise<void> {
  stamp.msg = msg;
  for (const { op, stamp: child } of stamp.ops.values()) {
    await computeMessages(child, msg ? await applyOp(op, msg) : null);
  }
}

// ---------------------------------------------------------------------------
// Serialisation

function writeAttestation(w: Writer, a: Attestation): void {
  w.bytes(attestationTag(a));
  const p = new Writer();
  if (a.kind === "pending") p.varbytes(new TextEncoder().encode(a.uri));
  else if (a.kind === "bitcoin") p.varuint(a.height);
  else p.bytes(a.payload);
  w.varbytes(p.finish());
}

function writeOp(w: Writer, op: Op): void {
  w.byte(opTag(op));
  if (op.kind === "append" || op.kind === "prepend") w.varbytes(op.arg);
}

export function writeTimestamp(w: Writer, stamp: Timestamp): void {
  if (!stamp.attestations.length && !stamp.ops.size) throw new OtsError("Empty timestamp");
  const atts = [...stamp.attestations].sort(compareAttestations);
  const ops = [...stamp.ops.values()].sort((a, b) => compareOps(a.op, b.op));
  for (const a of atts.slice(0, -1)) {
    w.bytes(Uint8Array.from([0xff, 0x00]));
    writeAttestation(w, a);
  }
  if (!ops.length) {
    w.byte(0x00);
    writeAttestation(w, atts[atts.length - 1]);
    return;
  }
  if (atts.length) {
    w.bytes(Uint8Array.from([0xff, 0x00]));
    writeAttestation(w, atts[atts.length - 1]);
  }
  for (const b of ops.slice(0, -1)) {
    w.byte(0xff);
    writeOp(w, b.op);
    writeTimestamp(w, b.stamp);
  }
  const last = ops[ops.length - 1];
  writeOp(w, last.op);
  writeTimestamp(w, last.stamp);
}

export function serializeTimestamp(stamp: Timestamp): Uint8Array {
  const w = new Writer();
  writeTimestamp(w, stamp);
  return w.finish();
}

/** Parses a bare timestamp rooted at `msg` (a calendar answer). */
export async function parseTimestamp(bytes: Uint8Array, msg: Uint8Array): Promise<Timestamp> {
  const r = new Reader(bytes);
  const stamp = readTimestamp(r);
  if (!r.atEnd()) throw new OtsError("Trailing bytes after the timestamp");
  await computeMessages(stamp, msg);
  return stamp;
}

// ---------------------------------------------------------------------------
// Tree operations

export function cloneTimestamp(stamp: Timestamp): Timestamp {
  const copy = new Timestamp(stamp.msg);
  copy.attestations = [...stamp.attestations];
  for (const [key, { op, stamp: child }] of stamp.ops) copy.ops.set(key, { op, stamp: cloneTimestamp(child) });
  return copy;
}

/** Union of `other` into `into` (both must commit to the same message). */
export function mergeTimestamp(into: Timestamp, other: Timestamp): void {
  if (into.msg && other.msg && !equalBytes(into.msg, other.msg)) throw new OtsError("Cannot merge timestamps of different messages");
  for (const a of other.attestations) addAttestation(into, a);
  for (const [key, branch] of other.ops) {
    const ours = into.ops.get(key);
    if (ours) mergeTimestamp(ours.stamp, branch.stamp);
    else into.ops.set(key, { op: branch.op, stamp: cloneTimestamp(branch.stamp) });
  }
}

export interface FoundAttestation {
  /** The message the attestation commits to (null under unsupported operations). */
  msg: Uint8Array | null;
  attestation: Attestation;
  node: Timestamp;
}

export function allAttestations(stamp: Timestamp): FoundAttestation[] {
  const out: FoundAttestation[] = stamp.attestations.map((attestation) => ({ msg: stamp.msg, attestation, node: stamp }));
  for (const { stamp: child } of stamp.ops.values()) out.push(...allAttestations(child));
  return out;
}

export function hasUnsupported(stamp: Timestamp): boolean {
  if (stamp.attestations.some((a) => a.kind === "unknown")) return true;
  for (const { op, stamp: child } of stamp.ops.values()) if (op.kind === "unsupported" || hasUnsupported(child)) return true;
  return false;
}
