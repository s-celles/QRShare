import { describe, expect, it } from "bun:test";
import { pdfPreviewBlob } from "../../src/ui/pdf-preview";

const enc = new TextEncoder();

describe("received PDF preview", () => {
  it("embeds only bytes starting with the %PDF- signature, as an application/pdf blob", async () => {
    const pdf = enc.encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const blob = pdfPreviewBlob(pdf);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("application/pdf");
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(pdf);
  });

  it("refuses anything else, whatever the file is called or declared as", () => {
    for (const content of [
      "<!doctype html><script>alert(document.domain)</script>",
      "<html><body onload=alert(1)>",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      " %PDF-1.7 leading space",
      "\n%PDF-1.7",
      "%PDF",
      "%pdf-1.7",
      "",
    ]) {
      expect(pdfPreviewBlob(enc.encode(content))).toBeNull();
    }
  });
});

describe("FilePreview PDF wiring", () => {
  it("never embeds the received (untyped) blob URL itself", async () => {
    const source = await Bun.file(new URL("../../src/ui/components/FilePreview.tsx", import.meta.url)).text();
    expect(source).toContain("pdfPreviewBlob(");
    const objects = [...source.matchAll(/<object[^>]*data=\{([^}]+)\}/g)].map((m) => m[1]);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects).not.toContain("url");
  });
});
