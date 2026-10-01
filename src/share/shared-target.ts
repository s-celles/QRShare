/**
 * Files received through the Web Share Target (REQ-HANDOFF-001). The service
 * worker stores the first shared file in this cache before redirecting to
 * `#/send?shared=1`; the transfer chooser takes it from there.
 */
export const SHARE_CACHE = "qrshare-share-target";
export const SHARED_ENTRY = "shared-file";

export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const key = new URL(SHARED_ENTRY, document.baseURI).href;
  const res = await cache.match(key);
  if (!res) return null;
  await cache.delete(key);
  const name = decodeURIComponent(res.headers.get("x-file-name") ?? "shared");
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}
