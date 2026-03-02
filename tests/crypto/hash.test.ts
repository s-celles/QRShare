import { describe, expect, it } from "bun:test";
import { hashSha256, truncatedHash } from "@/crypto/hash";

describe("HashService", () => {
  it("computes SHA-256 of empty input", async () => {
    const result = await hashSha256(new Uint8Array(0));
    // SHA-256 of empty string: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hex = Array.from(result).map(b => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("computes SHA-256 of known test vector", async () => {
    const input = new TextEncoder().encode("hello");
    const result = await hashSha256(input);
    // SHA-256 of "hello": 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hex = Array.from(result).map(b => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("returns Uint8Array of 32 bytes", async () => {
    const result = await hashSha256(new Uint8Array([1, 2, 3]));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it("truncates hash to specified number of bytes", async () => {
    const input = new TextEncoder().encode("hello");
    const full = await hashSha256(input);
    const truncated = await truncatedHash(input, 4);
    expect(truncated.length).toBe(4);
    expect(truncated[0]).toBe(full[0]);
    expect(truncated[1]).toBe(full[1]);
    expect(truncated[2]).toBe(full[2]);
    expect(truncated[3]).toBe(full[3]);
  });

  it("truncates to 1 byte", async () => {
    const result = await truncatedHash(new Uint8Array([42]), 1);
    expect(result.length).toBe(1);
  });

  it("truncates to full 32 bytes returns complete hash", async () => {
    const input = new TextEncoder().encode("test");
    const full = await hashSha256(input);
    const truncated = await truncatedHash(input, 32);
    expect(truncated).toEqual(full);
  });
});
