import { describe, expect, it } from "bun:test";
import { RISKY_EXTENSIONS, isRiskyExtension, sanitizeFilename } from "@/paste/attachments/filename";

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("REQ-PASTE-035 sanitizeFilename", () => {
  it("drops path components", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("../../secret.txt")).toBe("secret.txt");
    expect(sanitizeFilename("..")).toBe("attachment");
  });

  it("removes control, C1, bidi and invisible characters", () => {
    expect(sanitizeFilename("a\u0000b\u001fc\u007fd\u0085e.txt")).toBe("abcde.txt");
    expect(sanitizeFilename("invoice\u202Etxt.exe")).toBe("invoicetxt.exe");
    expect(sanitizeFilename("a\u200Bb\u200Fc\u2066d\uFEFFe\u061Cf\u00ADg.md")).toBe("abcdefg.md");
  });

  it("removes reserved characters", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.txt')).toBe("abcdefgh.txt");
  });

  it("trims leading dots and trailing dots and spaces", () => {
    expect(sanitizeFilename(".bashrc")).toBe("bashrc");
    expect(sanitizeFilename("  ...name.txt. . ")).toBe("name.txt");
  });

  it("avoids Windows reserved names", () => {
    expect(sanitizeFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFilename("con")).toBe("_con");
    expect(sanitizeFilename("lpt9.tar.gz")).toBe("_lpt9.tar.gz");
    expect(sanitizeFilename("console.txt")).toBe("console.txt");
  });

  it("limits the name to 100 UTF-8 bytes, keeping the extension", () => {
    const long = "é".repeat(80) + ".png";
    const out = sanitizeFilename(long);
    expect(bytes(out)).toBeLessThanOrEqual(100);
    expect(out.endsWith(".png")).toBe(true);
    expect(out).toBe("é".repeat(48) + ".png");
    const emoji = sanitizeFilename("😀".repeat(40));
    expect(bytes(emoji)).toBeLessThanOrEqual(100);
    expect(emoji).toBe("😀".repeat(25));
  });

  it("falls back to 'attachment'", () => {
    expect(sanitizeFilename("")).toBe("attachment");
    expect(sanitizeFilename("\u202E\u0000")).toBe("attachment");
    expect(sanitizeFilename("///")).toBe("attachment");
  });

  it("is idempotent", () => {
    const samples = ["CON.txt", "é".repeat(80) + ".png", "a. .b", "x".repeat(99) + " .y", "...", "a\\b/c", "nul.", "😀".repeat(40) + "." + "z".repeat(30)];
    for (let i = 0; i < 300; i++) {
      let s = "";
      for (let j = 0; j < 1 + (i % 60); j++) s += String.fromCodePoint([46, 32, 0x202e, 97, 0xe9, 0x1f600, 47, 67, 79, 78, 0][(i * 7 + j * 13) % 11]);
      samples.push(s);
    }
    for (const s of samples) {
      const once = sanitizeFilename(s);
      expect(sanitizeFilename(once)).toBe(once);
      expect(bytes(once)).toBeLessThanOrEqual(100);
      expect(once.length).toBeGreaterThan(0);
    }
  });
});

describe("REQ-PASTE-044 risky extensions", () => {
  it("flags executable and script extensions, double extensions included", () => {
    for (const name of ["setup.exe", "INVOICE.PDF.EXE", "run.sh", "page.html", "image.svg", "macro.docm", "a.ps1", "x.lnk"]) {
      expect(isRiskyExtension(name)).toBe(true);
    }
    for (const name of ["photo.webp", "notes.txt", "report.pdf", "exe", "archive.zip", "song.mp3"]) {
      expect(isRiskyExtension(name)).toBe(false);
    }
    expect(RISKY_EXTENSIONS.has("jar")).toBe(true);
  });
});
