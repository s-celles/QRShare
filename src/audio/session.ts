/**
 * Audio transfer sessions: fountain coding + compression + hashing around the
 * packet layer and modem (REQ-AUD-012, 015, 016, 036..039, 075..077).
 *
 * Sender:   payload → SHA-256 / 4-byte metadataHash → deflate → fountain encoder
 *           → packets M, D×8, M, D×8, … (rateless, until stopped).
 * Receiver: samples → StreamingDemodulator → packets → lock to the first session,
 *           buffer data until metadata, dedupe, decode → inflate → verify SHA-256.
 *
 * Pure TypeScript: no DOM or Web Audio dependency (REQ-AUD-110).
 */

import { hashSha256 } from "@/crypto/hash";
import { compress, decompress } from "@/compression/compression";
import { getCodecFactory } from "@/codec/factory";
import { LTCodecFactory } from "@/codec/lt-adapter";
import { WirehairCodecFactory } from "@/codec/wirehair-adapter";
import type { FountainCodecFactory, FountainDecoder, FountainEncoder } from "@/codec/types";
import { decodeFlags, encodeFlags, parseFrame, serializeFrame, PROTOCOL_VERSION, type Frame, type FrameCodec } from "@/protocol/frame";
import { StreamingDemodulator, type DemodEvent } from "./demodulator";
import { modulate } from "./modem";
import {
  encodeDataBody,
  encodeMetadataBody,
  encodeOnAir,
  encodeSealedMetadataBody,
  truncateFilename,
  maxFilenameBytes,
  type AudioPacket,
  type PacketDecodeResult,
} from "./packet";
import { SALT_BYTES, deriveSealKey, openMetadata, openPayload, randomBytes as cryptoRandomBytes, sealMetadata, sealPayload } from "./sealed";
import {
  AUDIO_MAX_BYTES,
  META_INTERVAL,
  effectiveBlockSize,
  estimateDurationSec,
  type AudioProfile,
  type AudioProfileId,
} from "./profiles";

/** On-air symbolIds are uint16 ≥ 1: fountain index i → (i mod 65535) + 1. */
export function onAirSymbolId(index: number): number {
  return (index % 0xffff) + 1;
}

const MAX_PENDING = 4096;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Audio session id (the frame's 4-byte `metadataHash`): the first 4 bytes of
 * SHA-256(sha256 ‖ blockSize ‖ flags ‖ compressedSize ‖ compressionId). Unlike QR,
 * it depends on the transfer parameters too, so a sender re-prepared with another
 * profile or codec starts a new session whose symbols never reach the old decoder.
 */
export async function audioSessionId(
  sha256: Uint8Array,
  blockSize: number,
  flags: number,
  compressedSize: number,
  compressionId: number,
): Promise<Uint8Array> {
  const buf = new Uint8Array(32 + 2 + 1 + 4 + 1);
  buf.set(sha256);
  const view = new DataView(buf.buffer);
  view.setUint16(32, blockSize, true);
  buf[34] = flags;
  view.setUint32(35, compressedSize, true);
  buf[39] = compressionId;
  return (await hashSha256(buf)).slice(0, 4);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class AudioPayloadTooLargeError extends Error {
  constructor(readonly size: number, readonly limit: number = AUDIO_MAX_BYTES) {
    super(`Payload of ${size} bytes exceeds the audio limit of ${limit} bytes`);
    this.name = "AudioPayloadTooLargeError";
  }
}

// ----------------------------------------------------------------------- sender

export type AudioCodecChoice = "auto" | "lt";

export interface AudioSendOptions {
  readonly isText: boolean;
  readonly profile: AudioProfile;
  /** "auto" prefers Wirehair (default); "lt" forces the LT compatibility codec. */
  readonly codec?: AudioCodecChoice;
  /** Factory used for "auto" (defaults to `getCodecFactory()`); injectable for tests. */
  readonly autoFactory?: () => Promise<FountainCodecFactory>;
  /** First fountain symbol index (tests / resume). */
  readonly startIndex?: number;
  /**
   * Seals the transfer: metadata and payload are encrypted with this password, the
   * payload padded to 256-byte steps and the session id random (see `sealed.ts`).
   */
  readonly password?: string;
}

export interface AudioSendInfo {
  readonly k: number;
  readonly blockSize: number;
  readonly compressedSize: number;
  readonly fileSize: number;
  readonly sha256Hex: string;
  readonly codec: FrameCodec;
  readonly filename: string;
  readonly estimatedMinSec: number;
  /** Hex of the 4-byte session id carried by every packet. */
  readonly sessionId: string;
  /** Password-sealed transfer (nothing readable on the air). */
  readonly sealed: boolean;
}

export interface AudioOutgoingPacket {
  readonly bytes: Uint8Array;
  readonly kind: "data" | "metadata";
  /** On-air symbolId (0 for metadata). */
  readonly symbolId: number;
}

export class AudioSendSession {
  private sent = 0;

  private constructor(
    readonly profile: AudioProfile,
    readonly info: AudioSendInfo,
    private readonly encoder: FountainEncoder,
    private readonly metadataBody: Uint8Array,
    private readonly metadataHash: Uint8Array,
    private index: number,
  ) {}

  static async create(data: Uint8Array, filename: string, opts: AudioSendOptions): Promise<AudioSendSession> {
    if (data.length > AUDIO_MAX_BYTES) throw new AudioPayloadTooLargeError(data.length);
    if (data.length === 0) throw new Error("Nothing to send");
    const { profile } = opts;

    const sha256 = await hashSha256(data);
    const compressed = compress(data);
    const password = opts.password?.trim() ? opts.password : undefined;

    // Sealed transfers fountain-encode the encrypted, padded payload instead.
    let salt: Uint8Array | null = null;
    let key: CryptoKey | null = null;
    let onAir = compressed.data;
    if (password) {
      salt = cryptoRandomBytes(SALT_BYTES);
      key = await deriveSealKey(password, salt);
      onAir = await sealPayload(compressed.data, key);
    }

    const blockSize = effectiveBlockSize(profile.blockSize, onAir.length);
    const k = Math.ceil(onAir.length / blockSize);

    // Wirehair needs K ≥ 2; a 1-byte payload falls back to LT.
    let factory: FountainCodecFactory = new LTCodecFactory();
    let codec: FrameCodec = "lt";
    if ((opts.codec ?? "auto") === "auto" && k >= 2) {
      const auto = await (opts.autoFactory ?? getCodecFactory)();
      if (auto.isWasmAvailable()) {
        factory = auto;
        codec = "wirehair";
      }
    }
    const encoder = await factory.createEncoder();
    encoder.init(onAir, blockSize);

    const safeName = truncateFilename(filename, maxFilenameBytes(profile, !!password));
    const flags = encodeFlags({ isText: opts.isText, codec });
    // A sealed session id is random: it must not let anyone confirm a guess of the content.
    const metadataHash = password
      ? cryptoRandomBytes(4)
      : await audioSessionId(sha256, blockSize, flags, compressed.data.length, compressed.algorithm);
    const meta = {
      flags,
      metadataHash,
      sourceBlockCount: k,
      blockSize,
      compressedSize: onAir.length,
      compressionId: compressed.algorithm,
      filename: safeName,
      fileSize: data.length,
      sha256,
    };
    let metadataBody: Uint8Array;
    if (password && key && salt) {
      const frame = serializeFrame({ ...meta, version: PROTOCOL_VERSION, symbolId: 0, payload: new Uint8Array(0) });
      const { iv, ciphertext } = await sealMetadata(frame, key, metadataHash, salt);
      metadataBody = encodeSealedMetadataBody(metadataHash, salt, iv, ciphertext);
    } else {
      metadataBody = encodeMetadataBody(meta, profile);
    }

    const info: AudioSendInfo = {
      k,
      blockSize,
      compressedSize: onAir.length,
      fileSize: data.length,
      sha256Hex: toHex(sha256),
      codec,
      filename: safeName,
      sessionId: toHex(metadataHash),
      sealed: !!password,
      estimatedMinSec: estimateDurationSec(onAir.length, profile, {
        codec,
        filenameBytes: new TextEncoder().encode(safeName).length,
      }),
    };
    return new AudioSendSession(profile, info, encoder, metadataBody, metadataHash, opts.startIndex ?? 0);
  }

  /** Packets emitted so far (metadata included). */
  get packetsSent(): number {
    return this.sent;
  }

  /** Distinct fountain symbols emitted so far, counted from index 0 (at most 65535 on air). */
  get uniqueSymbolsSent(): number {
    return Math.min(this.index, 0xffff);
  }

  /** Next packet: metadata first and after every META_INTERVAL data packets. */
  nextPacket(): AudioOutgoingPacket {
    const slot = this.sent % (META_INTERVAL + 1);
    this.sent++;
    if (slot === 0) {
      return { bytes: encodeOnAir(this.metadataBody, this.profile), kind: "metadata", symbolId: 0 };
    }
    const index = this.index++;
    const symbolId = onAirSymbolId(index);
    const symbol = this.encoder.encode(symbolId - 1);
    return {
      bytes: encodeOnAir(encodeDataBody(this.metadataHash, symbolId, symbol), this.profile),
      kind: "data",
      symbolId,
    };
  }

  /** Modulated samples of the next packet. */
  nextSamples(sampleRate: number): Float32Array {
    return modulate(this.nextPacket().bytes, this.profile, sampleRate);
  }

  free(): void {
    this.encoder.free();
  }
}

// --------------------------------------------------------------------- receiver

export interface ReceiveProgress {
  readonly kind: "progress";
  /** Distinct fountain symbols heard for the locked session. */
  readonly received: number;
  /** Source blocks K (0 until the metadata packet is heard). */
  readonly needed: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly duplicates: number;
  readonly profile: AudioProfileId | null;
  readonly filename?: string;
  readonly fileSize?: number;
  /** Fountain symbol size (0 until the metadata packet is heard). */
  readonly blockSize: number;
}

export interface ReceiveComplete {
  readonly kind: "complete";
  readonly file: Uint8Array;
  readonly filename: string;
  readonly sha256Hex: string;
  readonly verified: boolean;
  readonly isText: boolean;
  /** The transfer was password-sealed (and has been decrypted). */
  readonly sealed: boolean;
}

export interface ReceiveError {
  readonly kind: "error";
  /** `wrong_password` is not final: listening goes on and `setPassword` can retry. */
  readonly code: "wirehair_unavailable" | "decode_failed" | "wrong_password";
  readonly message: string;
}

/** A sealed transfer was detected and no password is set yet; listening goes on. */
export interface ReceivePasswordRequired {
  readonly kind: "password_required";
}

export type ReceiveEvent = DemodEvent | ReceiveProgress | ReceiveComplete | ReceiveError | ReceivePasswordRequired;

export interface AudioReceiveOptions {
  readonly wirehairFactory?: FountainCodecFactory;
  readonly ltFactory?: FountainCodecFactory;
  readonly profiles?: readonly AudioProfile[];
  /** Password for sealed transfers, when known before listening. */
  readonly password?: string;
}

type SealedMetadataPacket = Extract<AudioPacket, { kind: "sealed-metadata" }>;

function sameParameters(a: Frame, b: Frame): boolean {
  return a.blockSize === b.blockSize && a.sourceBlockCount === b.sourceBlockCount && a.flags === b.flags
    && a.compressedSize === b.compressedSize && a.compressionId === b.compressionId;
}

export class AudioReceiveSession {
  private readonly demod: StreamingDemodulator;
  private readonly wirehairFactory: FountainCodecFactory;
  private readonly ltFactory: FountainCodecFactory;
  private lockedHash: Uint8Array | null = null;
  private frame: Frame | null = null;
  private decoder: FountainDecoder | null = null;
  private readonly pending = new Map<number, Uint8Array>();
  private readonly seen = new Set<number>();
  private accepted = 0;
  private rejected = 0;
  private duplicates = 0;
  private profile: AudioProfileId | null = null;
  private done = false;
  private failed = false;
  private password: string | null = null;
  private readonly keys = new Map<string, CryptoKey>();
  /** Key of the locked sealed session (null for a clear session). */
  private sealKey: CryptoKey | null = null;
  /** Latest sealed metadata of the locked session that could not be opened yet. */
  private unopened: SealedMetadataPacket | null = null;
  private passwordRequested = false;
  private wrongReported: string | null = null;

  constructor(sampleRate: number, opts: AudioReceiveOptions = {}) {
    this.demod = new StreamingDemodulator(sampleRate, opts.profiles);
    this.password = opts.password?.trim() ? opts.password : null;
    this.wirehairFactory = opts.wirehairFactory ?? new WirehairCodecFactory();
    this.ltFactory = opts.ltFactory ?? new LTCodecFactory();
  }

  get sampleRate(): number {
    return this.demod.sampleRate;
  }

  get isDone(): boolean {
    return this.done || this.failed;
  }

  /** Feeds microphone samples; returns demodulator and transfer events in order. */
  async push(samples: Float32Array): Promise<ReceiveEvent[]> {
    const out: ReceiveEvent[] = [];
    for (const ev of this.demod.push(samples)) {
      if (ev.kind === "packet") out.push(ev, ...(await this.ingest(ev.result, ev.profile)));
      else out.push(ev);
    }
    return out;
  }

  /** Feeds one decoded (or rejected) packet. */
  async ingest(result: PacketDecodeResult, profile: AudioProfileId): Promise<ReceiveEvent[]> {
    if (this.isDone) return [];
    if (result.kind === "rejected") {
      this.rejected++;
      return [this.progress()];
    }
    const packet = result.packet;
    if (packet.kind === "sealed-metadata") return this.ingestSealed(packet, profile);
    const hash = packet.kind === "data" ? packet.metadataHash : packet.frame.metadataHash;
    if (!this.lockedHash) this.lockedHash = hash;
    else if (!equalBytes(this.lockedHash, hash)) {
      // Same content re-sent with other parameters (profile / codec): follow it.
      if (packet.kind === "metadata" && this.frame && !this.sealKey && equalBytes(packet.frame.sha256, this.frame.sha256)) {
        this.resetSession(hash);
      } else {
        return []; // another session (REQ-AUD-036)
      }
    } else if (packet.kind === "metadata" && this.frame && !sameParameters(this.frame, packet.frame)) {
      this.resetSession(hash);
    }
    this.accepted++;
    this.profile = profile;

    if (packet.kind === "metadata") return this.acceptFrame(packet.frame, null);

    // A symbol of the wrong size can never be used: do not let it shadow a valid one.
    if (this.frame && packet.symbol.length !== this.frame.blockSize) return [this.progress()];
    if (this.seen.has(packet.symbolId)) {
      this.duplicates++;
      return [this.progress()];
    }
    if (!this.decoder) {
      if (this.pending.size < MAX_PENDING) {
        this.seen.add(packet.symbolId);
        this.pending.set(packet.symbolId, packet.symbol);
      }
      return [this.progress()];
    }
    this.seen.add(packet.symbolId);
    const done = await this.addSymbol(packet.symbolId, packet.symbol);
    if (done) return [done];
    return [this.progress()];
  }

  /** Sets (or corrects) the password for a sealed transfer; retries the metadata heard so far. */
  async setPassword(password: string): Promise<ReceiveEvent[]> {
    this.password = password.trim() ? password : null;
    this.keys.clear();
    this.wrongReported = null;
    if (this.isDone || !this.unopened) return [];
    const packet = this.unopened;
    const opened = await this.open(packet);
    if (opened === "no_password") return [];
    if (opened === "wrong") return [this.wrongPassword()];
    this.unopened = null;
    return this.acceptFrame(opened.frame, opened.key);
  }

  private wrongPassword(): ReceiveError {
    this.wrongReported = this.password;
    return { kind: "error", code: "wrong_password", message: "Wrong password" };
  }

  private async open(packet: SealedMetadataPacket): Promise<{ frame: Frame; key: CryptoKey } | "no_password" | "wrong"> {
    if (!this.password) return "no_password";
    const saltHex = toHex(packet.salt);
    let key = this.keys.get(saltHex);
    if (!key) {
      key = await deriveSealKey(this.password, packet.salt);
      this.keys.set(saltHex, key);
    }
    const plain = await openMetadata(packet.ciphertext, packet.iv, key, packet.metadataHash, packet.salt);
    if (!plain) return "wrong";
    const parsed = parseFrame(plain);
    if (parsed.kind !== "data" || !equalBytes(parsed.frame.metadataHash, packet.metadataHash)) return "wrong";
    return { frame: parsed.frame, key };
  }

  private async ingestSealed(packet: SealedMetadataPacket, profile: AudioProfileId): Promise<ReceiveEvent[]> {
    const hash = packet.metadataHash;
    if (this.lockedHash && !equalBytes(this.lockedHash, hash)) {
      // Another session: follow it only if it is the same content (sender re-prepared).
      if (!this.frame) return [];
      const opened = await this.open(packet);
      if (typeof opened === "string" || !equalBytes(opened.frame.sha256, this.frame.sha256)) return [];
      this.resetSession(hash);
      this.accepted++;
      this.profile = profile;
      return this.acceptFrame(opened.frame, opened.key);
    }
    if (!this.lockedHash) this.lockedHash = hash;
    this.accepted++;
    this.profile = profile;
    if (this.frame) return [this.progress()];

    const opened = await this.open(packet);
    if (opened === "no_password") {
      this.unopened = packet;
      if (this.passwordRequested) return [this.progress()];
      this.passwordRequested = true;
      return [{ kind: "password_required" }, this.progress()];
    }
    if (opened === "wrong") {
      this.unopened = packet;
      if (this.wrongReported === this.password) return [this.progress()];
      return [this.wrongPassword(), this.progress()];
    }
    this.unopened = null;
    return this.acceptFrame(opened.frame, opened.key);
  }

  /** Starts decoding with the session's metadata and replays the buffered symbols. */
  private async acceptFrame(frame: Frame, key: CryptoKey | null): Promise<ReceiveEvent[]> {
    if (this.frame) return [this.progress()];
    this.sealKey = key;
    const error = await this.startDecoder(frame);
    if (error) {
      this.failed = true;
      return [error];
    }
    for (const [id, symbol] of this.pending) {
      if (symbol.length !== frame.blockSize) {
        this.seen.delete(id); // unusable: let a valid copy of this id in later
        continue;
      }
      const done = await this.addSymbol(id, symbol);
      if (done) {
        this.pending.clear();
        return [done];
      }
    }
    this.pending.clear();
    return [this.progress()];
  }

  /** Drops the decoder state and locks onto session `hash` (sender re-prepared). */
  private resetSession(hash: Uint8Array): void {
    this.decoder?.free();
    this.decoder = null;
    this.frame = null;
    this.pending.clear();
    this.seen.clear();
    this.duplicates = 0;
    this.lockedHash = hash;
    this.sealKey = null;
    this.unopened = null;
  }

  private async startDecoder(frame: Frame): Promise<ReceiveError | null> {
    const { codec } = decodeFlags(frame.flags);
    try {
      this.decoder = await (codec === "wirehair" ? this.wirehairFactory : this.ltFactory).createDecoder();
      this.decoder.init(frame.compressedSize, frame.blockSize);
      this.frame = frame;
      return null;
    } catch (err) {
      return {
        kind: "error",
        code: codec === "wirehair" ? "wirehair_unavailable" : "decode_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async addSymbol(symbolId: number, symbol: Uint8Array): Promise<ReceiveComplete | ReceiveError | null> {
    const frame = this.frame!;
    if (symbol.length !== frame.blockSize) return null;
    const status = this.decoder!.addSymbol(symbolId - 1, symbol);
    if (status.kind !== "complete") return null;
    try {
      const recovered = this.decoder!.recover();
      const compressed = this.sealKey ? await openPayload(recovered, this.sealKey) : recovered;
      const file = decompress(compressed, frame.compressionId);
      const sha = await hashSha256(file);
      this.done = true;
      this.decoder!.free();
      this.decoder = null;
      return {
        kind: "complete",
        file,
        filename: frame.filename,
        sha256Hex: toHex(sha),
        verified: equalBytes(sha, frame.sha256),
        isText: decodeFlags(frame.flags).isText,
        sealed: this.sealKey !== null,
      };
    } catch (err) {
      this.failed = true;
      return { kind: "error", code: "decode_failed", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private progress(): ReceiveProgress {
    return {
      kind: "progress",
      received: this.seen.size,
      needed: this.frame?.sourceBlockCount ?? 0,
      accepted: this.accepted,
      rejected: this.rejected,
      duplicates: this.duplicates,
      profile: this.profile,
      filename: this.frame?.filename,
      fileSize: this.frame?.fileSize,
      blockSize: this.frame?.blockSize ?? 0,
    };
  }

  free(): void {
    this.decoder?.free();
    this.decoder = null;
    this.pending.clear();
  }
}
