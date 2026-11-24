/** Decode the first QR code in a local image, including transparent PNGs. */
export async function scanQRImage(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    // Keep the RGBA buffer manageable for full-resolution camera photos.
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const { scanImageData, ZBarSymbolType } = await import("@undecaf/zbar-wasm");
    const symbols = await scanImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return symbols.find((symbol) => symbol.type === ZBarSymbolType.ZBAR_QRCODE)?.decode() ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readClipboardImage(): Promise<Blob | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((type) => type.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}
