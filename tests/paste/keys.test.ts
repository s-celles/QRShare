import { describe, expect, it } from "bun:test";
import { createAuthor, deriveRoomKeys, supportsEd25519 } from "@/paste/keys";
import { createIdentity } from "@/collab/core/identity";

const secret = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("REQ-PASTE-004 / REQ-PASTE-062 key derivation", () => {
  it("is deterministic and distinct per label", async () => {
    const a = await deriveRoomKeys(secret);
    const b = await deriveRoomKeys(secret);
    expect(a.roomId).toBe(b.roomId);
    expect(a.password).toBe(b.password);
    expect(hex(a.tag)).toBe(hex(b.tag));
    expect(a.roomId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.password).toMatch(/^[0-9a-f]{32}$/);
    expect(a.tag.length).toBe(16);
    const values = new Set([a.roomId, a.password, hex(a.tag)]);
    expect(values.size).toBe(3);
    // the secret itself never appears in derived values
    expect(a.roomId.includes(hex(secret))).toBe(false);
    expect(a.password.includes(hex(secret))).toBe(false);
  });

  it("differs between rooms", async () => {
    const other = await deriveRoomKeys(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 1]));
    const a = await deriveRoomKeys(secret);
    expect(other.roomId).not.toBe(a.roomId);
    expect(other.password).not.toBe(a.password);
  });

  it("gives a non-extractable AES-GCM content key shared by everyone with the secret", async () => {
    const a = await deriveRoomKeys(secret);
    const b = await deriveRoomKeys(secret);
    expect(a.contentKey.extractable).toBe(false);
    expect(a.contentKey.algorithm.name).toBe("AES-GCM");
    const iv = new Uint8Array(12);
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a.contentKey, new TextEncoder().encode("hi"));
    const open = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, b.contentKey, sealed);
    expect(new TextDecoder().decode(open)).toBe("hi");
  });
});

describe("REQ-PASTE-010 / REQ-PASTE-011 ephemeral author key", () => {
  it("is new per join, non-extractable and never stored", async () => {
    const writes: string[] = [];
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = { setItem: (k: string) => writes.push(k), getItem: () => null, removeItem: () => {} };
    try {
      expect(await supportsEd25519()).toBe(true);
      const a = await createAuthor();
      const b = await createAuthor();
      expect(hex(a.key.publicKey)).not.toBe(hex(b.key.publicKey));
      expect(a.key.privateKey.extractable).toBe(false);
      expect(a.key.publicKey.length).toBe(32);
      expect(writes).toEqual([]);
    } finally {
      g.localStorage = saved;
    }
  });

  it("derives pseudonym and colour from the key fingerprint", async () => {
    const a = await createAuthor();
    expect(a.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", a.key.publicKey as BufferSource));
    expect(a.fingerprint).toBe(hex(digest).slice(0, 8));
    expect(a.identity).toEqual(createIdentity(hex(digest)));
  });
});
