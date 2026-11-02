/**
 * CRC-32/IEEE (reflected, polynomial 0xEDB88320), table-driven.
 * Used to guard every audio packet body (REQ-AUD-070).
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const CRC32_INIT = 0xffffffff;

/** Feeds bytes into a running CRC state (start with `CRC32_INIT`). */
export function crc32Update(state: number, data: Uint8Array): number {
  let c = state >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** Finalises a running CRC state into the CRC value. */
export function crc32Final(state: number): number {
  return (state ^ 0xffffffff) >>> 0;
}

/** One-shot CRC-32 of `data`. */
export function crc32(data: Uint8Array): number {
  return crc32Final(crc32Update(CRC32_INIT, data));
}
