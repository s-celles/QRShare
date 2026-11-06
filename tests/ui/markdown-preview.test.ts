import { describe, expect, it } from "bun:test";
import { renderReceivedMarkdown } from "../../src/ui/markdown-preview";
import { isSafePasteHtml } from "../../src/paste/markdown";

const ORIGIN = "https://app.example";
const render = (md: string) => renderReceivedMarkdown(md, { origin: ORIGIN });

/** Every tag of the output is inert: no script, handler, style, id, active URL or remote source. */
function assertInert(html: string | null) {
  expect(html).not.toBeNull();
  expect(isSafePasteHtml(html!, ORIGIN)).toBe(true);
  for (const tag of html!.match(/<[a-z][^>]*>/gi) ?? []) {
    expect(tag).not.toMatch(/^<(script|style|iframe|object|embed|svg|math|form|base|meta|link|div|details|img)\b/i);
    expect(tag).not.toMatch(/\son[a-z]+\s*=|\sstyle\s*=|\sid\s*=/i);
    expect(tag).not.toMatch(/href="(?!https?:|mailto:)/i);
  }
}

describe("received Markdown file preview (safe renderer)", () => {
  for (const payload of [
    "[click](javascript:alert(document.cookie))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](blob:https://app.example/1234)",
    "[x](#/settings)",
    "[x][r]\n\n[r]: javascript:alert(1)",
    "<javascript:alert(1)>",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<iframe src=https://evil.example></iframe>",
    "```mermaid\ngraph TD; A-->B\n```",
    "# Heading that could clobber #settings",
  ]) {
    it(`neutralises ${JSON.stringify(payload)}`, () => {
      const html = render(payload);
      assertInert(html);
      // the payload may remain as visible (escaped) text, never inside a tag
      for (const tag of html!.match(/<[a-z][^>]*>/gi) ?? []) expect(tag).not.toMatch(/javascript:/i);
    });
  }

  it("never loads a remote image: it becomes a click-to-open chip naming the host", () => {
    const html = render("![tracking pixel](https://tracker.example/p.png?u=1)");
    assertInert(html);
    expect(html).toContain('class="paste-remote"');
    expect(html).toContain("tracker.example");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("keeps ordinary Markdown and safe links", () => {
    const html = render("# Title\n\n- **bold** item\n- [site](https://example.org)\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    assertInert(html);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.org/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">site</a>');
    expect(html).toContain("<table>");
  });

  it("does not resolve attachment: references in received files", () => {
    const html = render(`![x](attachment:${"a".repeat(64)}) [y](attachment:${"b".repeat(64)})`);
    assertInert(html);
    expect(html).not.toContain("paste-att");
    expect(html!.match(/paste-missing/g)?.length).toBe(2);
  });

  it("uses the given labels for chips and placeholders", () => {
    const html = renderReceivedMarkdown("![p](https://h.example/x.png) ![a](attachment:" + "c".repeat(64) + ")", {
      origin: ORIGIN,
      labels: { remoteImage: (host) => `image distante : ${host}`, missing: "absent" },
    });
    expect(html).toContain("image distante : h.example");
    expect(html).toContain("[absent]");
  });
});

describe("FilePreview wiring", () => {
  it("renders received Markdown only through the safe renderer", async () => {
    const source = await Bun.file(new URL("../../src/ui/components/FilePreview.tsx", import.meta.url)).text();
    expect(source).not.toMatch(/from "marked"/);
    expect(source).toContain("renderReceivedMarkdown(");
    // every innerHTML in the preview is the checked output
    expect([...source.matchAll(/dangerouslySetInnerHTML=\{\{ __html: ([^}]+) \}\}/g)].map((m) => m[1])).toEqual(["html"]);
  });
});
