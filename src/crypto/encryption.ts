const MAGIC = new Uint8Array([0x51, 0x52, 0x53, 0x45]); // "QRSE"
const VERSION = 0x01;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const HEADER_LENGTH = 4 + 1 + SALT_LENGTH + IV_LENGTH; // 33 bytes
const TEXT_PREFIX = "QRSENC:";

function getSubtleCrypto(): Crypto["subtle"] {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle;
  }
  throw new Error("Web Crypto API is not supported in this environment");
}

/**
 * Checks if a byte array contains an encrypted QRShare payload.
 */
export function isEncryptedPayload(data: Uint8Array): boolean {
  if (data.length < 5) return false;
  for (let i = 0; i < 4; i++) {
    if (data[i] !== MAGIC[i]) return false;
  }
  const version = data[4];
  if (version === 1 && data.length < HEADER_LENGTH) return false;
  if (version === 2 && data.length < 4 + 1 + 64 + IV_LENGTH) return false;
  return version === 1 || version === 2;
}

/**
 * Checks if a string contains an encrypted QRShare text payload.
 */
export function isEncryptedText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith(TEXT_PREFIX);
}

/**
 * Derives an AES-GCM 256-bit key from a password and salt using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts arbitrary binary data using AES-256-GCM and PBKDF2.
 */
export function encryptPayload(
  data: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  return deriveKey(password, salt).then(async (key) => {
    const ciphertextBuffer = await subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource,
    );
    const ciphertext = new Uint8Array(ciphertextBuffer);

    const packed = new Uint8Array(HEADER_LENGTH + ciphertext.length);
    packed.set(MAGIC, 0);
    packed[4] = VERSION;
    packed.set(salt, 5);
    packed.set(iv, 21);
    packed.set(ciphertext, 33);

    return packed;
  });
}

/**
 * Decrypts binary data previously encrypted with encryptPayload.
 */
export function decryptPayload(
  encryptedData: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  if (!isEncryptedPayload(encryptedData)) {
    return Promise.reject(new Error("Invalid encrypted payload format"));
  }

  const subtle = getSubtleCrypto();
  const salt = encryptedData.subarray(5, 21);
  const iv = encryptedData.subarray(21, 33);
  const ciphertext = encryptedData.subarray(33);

  return deriveKey(password, salt)
    .then(async (key) => {
      const decryptedBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      );
      return new Uint8Array(decryptedBuffer);
    })
    .catch(() => {
      throw new Error("Invalid password or corrupted payload");
    });
}

/**
 * Encrypts a text string into a QRSENC: prefixed base64 payload.
 */
export async function encryptText(
  text: string,
  password: string,
): Promise<string> {
  const data = new TextEncoder().encode(text);
  const encrypted = await encryptPayload(data, password);
  let binary = "";
  for (let i = 0; i < encrypted.length; i++) {
    binary += String.fromCharCode(encrypted[i]);
  }
  const base64 = btoa(binary);
  return TEXT_PREFIX + base64;
}

/**
 * Decrypts a QRSENC: prefixed base64 text payload back into plain text.
 */
export async function decryptText(
  encryptedText: string,
  password: string,
): Promise<string> {
  const trimmed = encryptedText.trim();
  if (!trimmed.startsWith(TEXT_PREFIX)) {
    throw new Error("Invalid encrypted text format");
  }
  const base64 = trimmed.substring(TEXT_PREFIX.length);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decryptedBytes = await decryptPayload(bytes, password);
  return new TextDecoder().decode(decryptedBytes);
}

/**
 * Derives an AES-GCM 256-bit key from ECDH shared secret.
 */
async function deriveKeyECDH(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const privateKey = await subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );
  const publicKey = await subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  return subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts arbitrary binary data using AES-256-GCM and ECDH (E2EE).
 * VERSION 2 payload format.
 */
export async function encryptPayloadECDH(
  data: Uint8Array,
  senderPrivateKeyJwk: JsonWebKey,
  receiverPublicKeyJwk: JsonWebKey,
  senderFingerprint: string
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKeyECDH(senderPrivateKeyJwk, receiverPublicKeyJwk);
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  const fingerprintBytes = new TextEncoder().encode(senderFingerprint); // 64 bytes
  const packed = new Uint8Array(4 + 1 + 64 + IV_LENGTH + ciphertext.length);
  packed.set(MAGIC, 0);
  packed[4] = 2; // VERSION 2 for ECDH
  packed.set(fingerprintBytes, 5);
  packed.set(iv, 5 + 64);
  packed.set(ciphertext, 5 + 64 + IV_LENGTH);

  return packed;
}

/**
 * Decrypts binary data previously encrypted with encryptPayloadECDH.
 */
export async function decryptPayloadECDH(
  encryptedData: Uint8Array,
  receiverPrivateKeyJwk: JsonWebKey,
  getSenderPublicKeyJwk: (fingerprint: string) => Promise<JsonWebKey | null>
): Promise<Uint8Array> {
  if (encryptedData.length < 4 + 1 + 64 + IV_LENGTH) {
    throw new Error("Invalid encrypted payload format");
  }
  if (encryptedData[4] !== 2) {
    throw new Error("Not an ECDH encrypted payload");
  }
  const subtle = getSubtleCrypto();
  const fingerprintBytes = encryptedData.subarray(5, 5 + 64);
  const fingerprint = new TextDecoder().decode(fingerprintBytes);
  const iv = encryptedData.subarray(5 + 64, 5 + 64 + IV_LENGTH);
  const ciphertext = encryptedData.subarray(5 + 64 + IV_LENGTH);

  const senderPublicKeyJwk = await getSenderPublicKeyJwk(fingerprint);
  if (!senderPublicKeyJwk) {
    throw new Error("Unknown sender identity: " + fingerprint);
  }

  const key = await deriveKeyECDH(receiverPrivateKeyJwk, senderPublicKeyJwk);
  try {
    const decryptedBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return new Uint8Array(decryptedBuffer);
  } catch {
    throw new Error("Invalid ECDH keys or corrupted payload");
  }
}

