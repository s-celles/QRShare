/**
 * Saves bytes or text as a download (Blob, object URL, `download` attribute),
 * never opening or navigating to the object URL; the URL is revoked shortly after
 * the click.
 */
export function saveBlob(data: Uint8Array | string, name: string, type = "application/octet-stream"): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
