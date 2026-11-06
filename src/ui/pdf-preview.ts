/**
 * Inline preview of received PDFs. Received files are untyped `blob:` URLs of the app's
 * origin: embedding one in `<object>` because of its name or declared type could let a
 * browser sniff HTML in it and run it in QRShare's origin. So a file is embedded only
 * when its bytes start with the `%PDF-` signature (strictly at offset 0), and then from a
 * new blob explicitly typed `application/pdf`; anything else gets no inline preview.
 */
const SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function pdfPreviewBlob(bytes: Uint8Array): Blob | null {
  if (bytes.length < SIGNATURE.length || !SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
