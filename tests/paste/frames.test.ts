import { describe, expect, it } from "bun:test";
import {
  FrameType,
  MAX_BLOB_FRAME,
  MAX_CONTROL_FRAME,
  actionOf,
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
} from "@/paste/frames";
import { deriveRoomKeys } from "@/paste/keys";
import { hex, roomKeys } from "./helpers";

const ids = [new Uint8Array(32).fill(3), new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];

describe("REQ-PASTE-060 frame encryption", () => {
  it("seals and opens every frame type", async () => {
    const { contentKey } = await roomKeys();
    for (const type of [FrameType.INV, FrameType.WANT, FrameType.ITEM, FrameType.PROOF, FrameType.DIGEST, FrameType.BLOB_WANT, FrameType.BLOB]) {
      const plain = new Uint8Array([type, 1, 2, 3]);
      const frame = await sealFrame(contentKey, type, plain);
      expect(frame[0]).toBe(1);
      expect(frame[1]).toBe(type);
      expect(frame.length).toBe(2 + 12 + plain.length + 16);
      const opened = await openFrame(contentKey, frame);
      expect(opened?.type).toBe(type);
      expect([...opened!.plaintext]).toEqual([...plain]);
    }
  });

  it("uses a fresh random nonce per frame", async () => {
    const { contentKey } = await roomKeys();
    const a = await sealFrame(contentKey, FrameType.INV, new Uint8Array(4));
    const b = await sealFrame(contentKey, FrameType.INV, new Uint8Array(4));
    expect(hex(a.subarray(2, 14))).not.toBe(hex(b.subarray(2, 14)));
  });

  it("REQ-PASTE-061 returns null for a wrong key, a tampered header or body, or garbage", async () => {
    const { contentKey } = await roomKeys();
    const other = (await deriveRoomKeys(new Uint8Array(10))).contentKey;
    const frame = await sealFrame(contentKey, FrameType.ITEM, new Uint8Array([1, 2, 3]));
    expect(await openFrame(other, frame)).toBeNull();
    const retyped = frame.slice();
    retyped[1] = FrameType.INV; // header is authenticated
    expect(await openFrame(contentKey, retyped)).toBeNull();
    const reversioned = frame.slice();
    reversioned[0] = 2;
    expect(await openFrame(contentKey, reversioned)).toBeNull();
    const body = frame.slice();
    body[20] ^= 1;
    expect(await openFrame(contentKey, body)).toBeNull();
    expect(await openFrame(contentKey, new Uint8Array(10))).toBeNull();
    const unknown = await sealFrame(contentKey, 9 as FrameType, new Uint8Array(1));
    expect(await openFrame(contentKey, unknown)).toBeNull();
  });
});

describe("REQ-PASTE-075 frame size limits per action", () => {
  it("caps control frames at 64 KiB and blob frames at 5 MiB + 1 KiB", () => {
    expect(MAX_CONTROL_FRAME).toBe(64 * 1024);
    expect(MAX_BLOB_FRAME).toBe(5 * 1024 * 1024 + 1024);
    expect(frameSizeOk("paste", MAX_CONTROL_FRAME)).toBe(true);
    expect(frameSizeOk("paste", MAX_CONTROL_FRAME + 1)).toBe(false);
    expect(frameSizeOk("pblob", MAX_BLOB_FRAME)).toBe(true);
    expect(frameSizeOk("pblob", MAX_BLOB_FRAME + 1)).toBe(false);
    expect(frameSizeOk("paste", 10)).toBe(false); // shorter than header + tag
  });

  it("maps types to actions", () => {
    expect(actionOf(FrameType.BLOB)).toBe("pblob");
    expect(actionOf(FrameType.ITEM)).toBe("paste");
  });
});

describe("frame payloads", () => {
  it("encodes sorted id lists and rejects malformed ones", () => {
    const list = encodeIdList(ids);
    expect(list.length).toBe(96);
    const back = decodeIdList(list)!;
    expect(back.map((x) => x[0])).toEqual([1, 2, 3]);
    expect(decodeIdList(new Uint8Array(33))).toBeNull();
  });

  it("encodes digests, proofs and blobs", () => {
    const d = decodeDigest(encodeDigest(7, new Uint8Array(32).fill(9)))!;
    expect(d.count).toBe(7);
    expect(d.hash[0]).toBe(9);
    expect(decodeDigest(new Uint8Array(33))).toBeNull();
    const p = decodeProof(encodeProof(ids[0], new Uint8Array(64).fill(8), new Uint8Array([1, 2])))!;
    expect(p.id[0]).toBe(3);
    expect(p.signature.length).toBe(64);
    expect(p.signature[0]).toBe(8);
    expect([...p.ots]).toEqual([1, 2]);
    expect(decodeProof(new Uint8Array(32 + 64))).toBeNull();
    expect(decodeProof(new Uint8Array(32 + 64 + 16 * 1024 + 1))).toBeNull();
    const b = decodeBlob(encodeBlob(ids[1], new Uint8Array([5])))!;
    expect(b.hash[0]).toBe(1);
    expect([...b.bytes]).toEqual([5]);
    expect(decodeBlob(new Uint8Array(31))).toBeNull();
  });
});
