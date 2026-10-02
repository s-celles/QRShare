import { describe, expect, it } from "bun:test";
import { readdirSync } from "fs";
import { resolve } from "path";
import { DOC_PAGES, docLanguage, docRoute, findDocByFile, findDocPage } from "../../src/ui/docs";
import { markdownToHtml } from "../../src/ui/markdown";

const docsDir = resolve(import.meta.dir, "../../docs");

describe("in-app documentation", () => {
  it("bundles every Markdown page of docs/ (except the folder README)", () => {
    const files = readdirSync(docsDir).filter((f) => f.endsWith(".md") && f !== "README.md");
    const registered = DOC_PAGES.flatMap((page) => Object.values(page.files));
    expect(registered.sort()).toEqual(files.sort());
  });

  it("gives every page content and a unique slug", () => {
    expect(new Set(DOC_PAGES.map((p) => p.slug)).size).toBe(DOC_PAGES.length);
    for (const page of DOC_PAGES) expect(page.content.en.length).toBeGreaterThan(100);
  });

  it("finds pages by slug and by file name in any language", () => {
    expect(findDocPage("connectivity")?.files.en).toBe("en-connectivity-and-turn.md");
    expect(findDocByFile("fr-guide-utilisateur.md")?.slug).toBe("user-guide");
    expect(findDocByFile("docs/en-architecture.md")?.slug).toBe("architecture");
    expect(findDocByFile("unknown.md")).toBeUndefined();
  });

  it("falls back to English when a page has no translation", () => {
    expect(docLanguage(findDocPage("user-guide")!, "fr")).toBe("fr");
    expect(docLanguage(findDocPage("architecture")!, "fr")).toBe("en");
    expect(docLanguage(findDocPage("user-guide")!, "ar")).toBe("en");
  });

  it("keeps links between docs pages inside the app", () => {
    for (const page of DOC_PAGES) {
      const html = markdownToHtml(page.content.en, (href) => {
        const target = findDocByFile(href);
        return target ? docRoute(target.slug) : null;
      });
      // No relative link to a Markdown file should be left pointing outside the app.
      expect(html).not.toMatch(/href="(?!https?:|#)[^"]*\.md"/);
    }
  });
});

describe("markdownToHtml", () => {
  it("renders Mermaid blocks as diagrams and other code as code", () => {
    const html = markdownToHtml("```mermaid\nA --> B\n```\n\n```bash\necho <hi>\n```");
    expect(html).toContain('<div class="mermaid">A --&gt; B</div>');
    expect(html).toContain("echo &lt;hi&gt;");
  });

  it("renders tables and opens external links in a new tab", () => {
    const html = markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.org)");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://example.org" target="_blank" rel="noopener noreferrer"');
  });

  it("rewrites resolved links to in-app addresses", () => {
    const html = markdownToHtml("[guide](en-user-guide.md)", () => "#/docs?page=user-guide");
    expect(html).toContain('<a href="#/docs?page=user-guide">guide</a>');
  });
});
