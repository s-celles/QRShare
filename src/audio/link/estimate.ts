/**
 * Transmission time estimates for audio sessions (REQ-ALS-042), from the same
 * packet sizes and timing rules as the protocol, so the UI can tell the user how
 * long a message or a file will take.
 */

import {
  META_INTERVAL,
  dataBodyLen,
  effectiveBlockSize,
  metadataBodyLen,
  packetDurationSec,
  symbolsNeeded,
  type AudioProfile,
} from "../profiles";
import { sealedPayloadLength } from "../sealed";
import { LINK_HEADER_BYTES } from "../packet";
import { MEAN_TURN_WAIT_SEC } from "./mac";
import { TIMING } from "./room";

/** Silence after each session-file metadata packet, so members can answer (REQ-ALS-031). */
export const FILE_LISTEN_MS = 1500;
const GCM_TAG = 16;
const CRC = 4;
/** Sealed metadata adds salt, IV, tag and session id to the clear frame (about 48 bytes). */
const SEALED_METADATA_EXTRA = 48;
/** Typical generated name ("Swift Crimson Falcon"). */
const TYPICAL_NAME_BYTES = 20;

/**
 * Seconds until a chat message of `textBytes` UTF-8 bytes is sent and acknowledged by
 * the `members − 1` others: a turn, the message packet, then one presence packet per
 * other member (each after its acknowledgement delay and its own turn).
 */
export function estimateChatSeconds(textBytes: number, profile: AudioProfile, members: number): number {
  const message = packetDurationSec(profile, LINK_HEADER_BYTES + 4 + textBytes + GCM_TAG + CRC);
  const others = Math.max(1, members - 1);
  const presenceBody = LINK_HEADER_BYTES + 1 + TYPICAL_NAME_BYTES + 1 + 8 * others + GCM_TAG + CRC;
  const ack = packetDurationSec(profile, presenceBody);
  const meanAckDelay = (TIMING.ackDelayMinMs + TIMING.ackDelayMaxMs) / 2000;
  return MEAN_TURN_WAIT_SEC + message + meanAckDelay + others * (MEAN_TURN_WAIT_SEC + ack);
}

/**
 * Seconds to deliver a file of `size` bytes in a session: sealed and padded, without
 * counting compression (an upper bound for text), with the listen pause after every
 * metadata packet and a turn before every packet.
 */
export function estimateSessionFileSeconds(size: number, profile: AudioProfile, filenameBytes = 12): number {
  const sealed = sealedPayloadLength(size);
  const blockSize = effectiveBlockSize(profile.blockSize, sealed);
  const k = Math.ceil(sealed / blockSize);
  const data = symbolsNeeded(k, "wirehair");
  const metas = Math.ceil(data / META_INTERVAL);
  const tData = packetDurationSec(profile, dataBodyLen(blockSize));
  const tMeta = packetDurationSec(profile, metadataBodyLen(filenameBytes) + SEALED_METADATA_EXTRA);
  return data * tData + metas * (tMeta + FILE_LISTEN_MS / 1000) + (data + metas) * MEAN_TURN_WAIT_SEC;
}
