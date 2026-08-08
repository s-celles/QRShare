function getSubtleCrypto(): Crypto["subtle"] {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle;
  }
  throw new Error("Web Crypto API is not available in this environment.");
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface PeerIdentity {
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}

export interface StoredIdentity extends PeerIdentity {
  privateKeyJwk: JsonWebKey;
}

let cachedIdentity: StoredIdentity | null = null;
let cachedPrivateKeyParams: CryptoKey | null = null;

export async function getLocalIdentity(): Promise<StoredIdentity> {
  if (cachedIdentity) return cachedIdentity;

  const stored = localStorage.getItem("qrshare_identity");
  if (stored) {
    try {
      const identity: StoredIdentity = JSON.parse(stored);
      cachedIdentity = identity;
      return identity;
    } catch {
      // JSON parse failed, regenerate
    }
  }

  // Generate new ECDSA P-256 keypair
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable
    ["sign", "verify"]
  );

  const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);

  // Generate fingerprint (SHA-256 of public key x and y coordinates for simplicity)
  const keyString = `${publicKeyJwk.x}|${publicKeyJwk.y}`;
  const hashBuffer = await subtle.digest("SHA-256", new TextEncoder().encode(keyString));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  
  const fingerprint = hashHex.substring(0, 8); // 8-char hex fingerprint

  const identity: StoredIdentity = {
    publicKeyJwk,
    privateKeyJwk,
    fingerprint,
  };

  localStorage.setItem("qrshare_identity", JSON.stringify(identity));
  cachedIdentity = identity;
  cachedPrivateKeyParams = keyPair.privateKey;
  
  return identity;
}

export async function signMessage(message: string): Promise<string> {
  const subtle = getSubtleCrypto();
  const identity = await getLocalIdentity();
  
  let privateKey = cachedPrivateKeyParams;
  if (!privateKey) {
    privateKey = await subtle.importKey(
      "jwk",
      identity.privateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    cachedPrivateKeyParams = privateKey;
  }

  const dataBuffer = new TextEncoder().encode(message);
  const signatureBuffer = await subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    dataBuffer
  );

  return bufferToBase64(signatureBuffer);
}

export async function verifySignature(
  publicKeyJwk: JsonWebKey,
  message: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const subtle = getSubtleCrypto();
    const publicKey = await subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const dataBuffer = new TextEncoder().encode(message);
    const signatureBuffer = base64ToBuffer(signatureBase64);

    return await subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      publicKey,
      signatureBuffer,
      dataBuffer
    );
  } catch (err) {
    console.error("Signature verification failed:", err);
    return false;
  }
}
