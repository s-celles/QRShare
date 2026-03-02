export async function hashSha256(data: Uint8Array): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest("SHA-256", data as ArrayBufferView<ArrayBuffer>);
  return new Uint8Array(buffer);
}

export async function truncatedHash(
  data: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const full = await hashSha256(data);
  return full.slice(0, bytes);
}
