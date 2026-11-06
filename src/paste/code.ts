/**
 * Paste-board room secret and its human form (REQ-PASTE-001, 002): 80 random bits
 * written as 16 Crockford base32 characters in four groups ("7KQ2-M9XD-4TPA-WZ3H").
 */

export const SECRET_BYTES = 10;
export const CODE_LENGTH = 16;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newRoomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

/** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS". */
export function formatCode(bare: string): string {
  return bare.match(/.{1,4}/g)?.join("-") ?? "";
}

export function secretToCode(secret: Uint8Array): string {
  if (secret.length !== SECRET_BYTES) throw new Error("A room secret has 10 bytes");
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of secret) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return formatCode(out);
}

/**
 * The canonical code (upper case, grouped), or null when malformed: case and the
 * separators space, "-" and "_" are ignored; I and L read as 1, O as 0.
 */
export function normalizeCode(input: string): string | null {
  const bare = input
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (bare.length !== CODE_LENGTH) return null;
  for (const c of bare) if (!ALPHABET.includes(c)) return null;
  return formatCode(bare);
}

export function codeToSecret(input: string): Uint8Array | null {
  const code = normalizeCode(input);
  if (!code) return null;
  const out = new Uint8Array(SECRET_BYTES);
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const c of code.replace(/-/g, "")) {
    buffer = (buffer << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = (buffer >> bits) & 255;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** `<app URL>#/paste?k=<code>` (REQ-PASTE-001). */
export function pasteLink(appUrl: string, code: string): string {
  return `${appUrl.split("#")[0]}#/paste?k=${code.replace(/-/g, "")}`;
}

/** The normalised code of a paste-board link, or null. */
export function readPasteLink(link: string): string | null {
  const hash = link.includes("#") ? link.slice(link.indexOf("#") + 1) : "";
  const [path, query] = hash.split("?", 2);
  if (path !== "/paste" || !query) return null;
  const k = new URLSearchParams(query).get("k");
  return k ? normalizeCode(k) : null;
}
