import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AUTHOR_NAME, AUTHOR_URL } from "../../src/ui/links";
import pkg from "../../package.json";

describe("About window", () => {
  it("names the author with a link to their GitHub profile (REQ-DOC-001)", () => {
    expect(AUTHOR_NAME).toBe("Sébastien Celles");
    expect(AUTHOR_URL).toBe("https://github.com/s-celles");
    const source = readFileSync(resolve(import.meta.dir, "../../src/ui/components/About.tsx"), "utf8");
    expect(source).toContain('t("about.author")');
    expect(source).toContain("href={AUTHOR_URL}");
  });

  it("declares the same author in package.json", () => {
    expect(pkg.author).toBe(`${AUTHOR_NAME} (${AUTHOR_URL})`);
  });
});
