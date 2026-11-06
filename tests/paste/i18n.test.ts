import { describe, expect, it } from "bun:test";
import { en } from "@/ui/translations/en";
import { fr } from "@/ui/translations/fr";
import { ar } from "@/ui/translations/ar";

const isPaste = (k: string) => k.startsWith("paste.") || k.startsWith("pasteProof.") || k.startsWith("landing.paste");

describe("REQ-PASTE-111 paste-board translations", () => {
  const keys = Object.keys(en).filter(isPaste).sort();

  it("defines the same paste-board keys in English, French and Arabic", () => {
    expect(keys.length).toBeGreaterThan(100);
    expect(Object.keys(fr).filter(isPaste).sort()).toEqual(keys);
    expect(Object.keys(ar).filter(isPaste).sort()).toEqual(keys);
  });

  it("translates them (Arabic texts are written in Arabic)", () => {
    const arabic = /[؀-ۿ]/;
    const notArabic = keys.filter((k) => !arabic.test(ar[k]) && !/^(Markdown|ZIP)/.test(en[k]));
    expect(notArabic).toEqual([]);
    expect(keys.filter((k) => fr[k] === en[k] && !/^(Markdown|Format|Source|Signature \(\.sig\))$/.test(en[k]))).toEqual([]);
  });
});
