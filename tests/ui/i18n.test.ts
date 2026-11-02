import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { en } from "../../src/ui/translations/en";
import { fr } from "../../src/ui/translations/fr";
import { ar } from "../../src/ui/translations/ar";

const src = resolve(import.meta.dir, "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "translations" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("REQ-I18N-001 translations", () => {
  const keys = Object.keys(en).sort();

  it("translates every English text into French and Arabic, with no stray keys", () => {
    expect(Object.keys(fr).sort()).toEqual(keys);
    expect(Object.keys(ar).sort()).toEqual(keys);
  });

  it("defines every literal key the code passes to t()", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(src)) {
      for (const [, key] of readFileSync(file, "utf8").matchAll(/\bt\("([a-zA-Z][\w.-]*)"/g)) {
        if (!(key in en)) missing.add(`${key} (${file.slice(src.length + 1)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("keeps the same placeholders in every language", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const differ = keys.filter(
      (key) =>
        placeholders(en[key]).join() !== placeholders(fr[key]).join() ||
        placeholders(en[key]).join() !== placeholders(ar[key]).join(),
    );
    expect(differ).toEqual([]);
  });
});
