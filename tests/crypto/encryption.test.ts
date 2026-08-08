import { describe, expect, test } from "bun:test";
import {
  encryptPayload,
  decryptPayload,
  isEncryptedPayload,
  encryptText,
  decryptText,
  isEncryptedText,
} from "@/crypto/encryption";

describe("E2E Encryption Service (AES-256-GCM + PBKDF2)", () => {
  test("isEncryptedPayload detects magic header and version", async () => {
    const plain = new Uint8Array([1, 2, 3, 4, 5]);
    expect(isEncryptedPayload(plain)).toBe(false);

    const encrypted = await encryptPayload(plain, "mySecret123");
    expect(isEncryptedPayload(encrypted)).toBe(true);
  });

  test("encrypts and decrypts binary payload correctly", async () => {
    const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const password = "SuperSecretPassword!";

    const encrypted = await encryptPayload(original, password);
    expect(encrypted.length).toBeGreaterThan(33);

    const decrypted = await decryptPayload(encrypted, password);
    expect(Array.from(decrypted)).toEqual(Array.from(original));
  });

  test("fails decryption with wrong password", async () => {
    const original = new TextEncoder().encode("Top Secret Message");
    const encrypted = await encryptPayload(original, "CorrectPassword");

    expect(decryptPayload(encrypted, "WrongPassword")).rejects.toThrow(
      "Invalid password or corrupted payload",
    );
  });

  test("fails decryption with tampered ciphertext", async () => {
    const original = new TextEncoder().encode("Sensitive Data");
    const encrypted = await encryptPayload(original, "Password");

    // Tamper with a byte in ciphertext
    encrypted[encrypted.length - 1] ^= 0xff;

    expect(decryptPayload(encrypted, "Password")).rejects.toThrow(
      "Invalid password or corrupted payload",
    );
  });

  test("isEncryptedText detects QRSENC: prefix", () => {
    expect(isEncryptedText("Hello World")).toBe(false);
    expect(isEncryptedText("QRSENC:aW52YWxpZA==")).toBe(true);
  });

  test("encrypts and decrypts text strings correctly", async () => {
    const text = "Confidential Wi-Fi Password: MySecretPass123!";
    const password = "PassWord456";

    const encryptedText = await encryptText(text, password);
    expect(encryptedText.startsWith("QRSENC:")).toBe(true);

    const decryptedText = await decryptText(encryptedText, password);
    expect(decryptedText).toBe(text);
  });

  test("fails text decryption with wrong password", async () => {
    const text = "Secret note";
    const encryptedText = await encryptText(text, "RightPass");

    expect(decryptText(encryptedText, "WrongPass")).rejects.toThrow(
      "Invalid password or corrupted payload",
    );
  });
});
