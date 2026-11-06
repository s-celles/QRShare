import { describe, expect, it } from "bun:test";
import { attachmentRefs, isSafePasteHtml, renderPasteMarkdown, renderPasteSafely, type AttachmentView } from "@/paste/markdown";

const IMG = "a".repeat(64);
const FILE = "b".repeat(64);
const ORIGIN = "https://app.example";
const resolve = (hash: string): AttachmentView => {
  if (hash === IMG) return { kind: "image", url: `blob:${ORIGIN}/1234-5678`, width: 640, height: 480 };
  if (hash === FILE) return { kind: "file", hash };
  return { kind: "missing" };
};
const render = (md: string) => renderPasteMarkdown(md, resolve);

/** No executable or auto-loading content, whatever the input (escaped text is inert). */
function assertInert(html: string) {
  expect(isSafePasteHtml(html, ORIGIN)).toBe(true);
  const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
  for (const tag of tags) {
    expect(tag).not.toMatch(/^<(script|style|iframe|object|embed|svg|math|form|base|meta|link|div|details)\b/i);
    expect(tag).not.toMatch(/\son[a-z]+\s*=/i);
    expect(tag).not.toMatch(/\sstyle\s*=/i);
    expect(tag).not.toMatch(/\sid\s*=/i);
    expect(tag).not.toMatch(/href="(?!https?:|mailto:)/i);
    expect(tag).not.toMatch(/src="(?!blob:)/i);
  }
}

describe("REQ-PASTE-024 raw HTML is shown as text", () => {
  for (const payload of [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
    "<iframe src=https://evil.example></iframe>",
    "<style>body{display:none}</style>",
    '<a href="javascript:alert(1)">x</a>',
    "text <b onclick=alert(1)>inline</b> text",
    "<div style=\"position:fixed\">x</div>",
    "<!-- comment --><details open ontoggle=alert(1)>",
  ]) {
    it(`neutralises ${payload}`, () => {
      const html = render(payload);
      assertInert(html);
      expect(html).toContain("&lt;");
    });
  }

  it("emits headings without id and code blocks without Mermaid", () => {
    const html = render("# Title\n\n## Sub\n\n```mermaid\ngraph TD; A-->B\n```\n\n```js\nalert(1)\n```");
    assertInert(html);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toContain("mermaid\"");
    expect(html).not.toContain("class=\"mermaid\"");
    expect(html).not.toContain("language-");
    expect(html).toContain("<pre><code>graph TD; A--&gt;B");
  });

  it("escapes HTML in code spans", () => {
    const html = render("`<script>alert(1)</script>`");
    assertInert(html);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders GFM tables, lists, task lists (disabled) and strikethrough", () => {
    const html = render("| a | b |\n|:-|-:|\n| 1 | 2 |\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo\n\n~~old~~ **b** _i_\nline");
    assertInert(html);
    expect(html).toContain("<table>");
    expect(html).toContain('align="left"');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<input type="checkbox" disabled="" checked="">');
    expect(html).toContain('<input type="checkbox" disabled="">');
    expect(html).toContain("<del>old</del>");
    expect(html).toContain("<br>");
  });
});

describe("REQ-PASTE-025 links", () => {
  it("keeps http, https and mailto links, opening in a new tab without referrer", () => {
    const html = render("[a](https://example.org/x?y=1&z=2) [b](http://example.org) [c](mailto:me@example.org) <https://auto.example> www.bare.example");
    assertInert(html);
    expect(html).toContain('<a href="https://example.org/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">a</a>');
    expect(html).toContain('href="mailto:me@example.org"');
    expect(html).toContain('href="https://auto.example/"');
    expect(html).toContain('href="http://www.bare.example/"');
  });

  for (const md of [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](  javascript:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox(1))",
    "[x](blob:https://app.example/123)",
    "[x](file:///etc/passwd)",
    "[x](#/settings)",
    "[x](/relative/path)",
    "[x](relative.html)",
    "[x][ref]\n\n[ref]: javascript:alert(1)",
    "<javascript:alert(1)>",
    "[x](https://ok.example \"t\" onmouseover=\"alert(1)\")",
  ]) {
    it(`shows ${JSON.stringify(md)} as text`, () => {
      const html = render(md);
      assertInert(html);
      expect(html).not.toMatch(/href="(?!https:\/\/ok\.example\/")/);
      expect(html).not.toMatch(/<a [^>]*on[a-z]+=/);
    });
  }
});

describe("REQ-PASTE-026 remote images are never loaded", () => {
  it("shows a remote image as a chip naming the host", () => {
    const html = render("![pixel](https://tracker.example/p.png)");
    assertInert(html);
    expect(html).not.toContain("<img");
    expect(html).toContain('class="paste-remote"');
    expect(html).toContain("tracker.example");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("shows a non-http image source as text", () => {
    const html = render("![x](javascript:alert(1)) ![y](data:image/png;base64,AAAA)");
    assertInert(html);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href=");
  });
});

describe("REQ-PASTE-045 attachment references", () => {
  it("renders a resolved image attachment as a blob image", () => {
    const html = render(`![photo](attachment:${IMG})`);
    assertInert(html);
    expect(html).toContain(`<img src="blob:${ORIGIN}/1234-5678" alt="photo" width="640" height="480" loading="lazy" decoding="async">`);
  });

  it("renders a file attachment (link or image syntax) as a chip", () => {
    const html = render(`[the doc](attachment:${FILE}) ![x](attachment:${FILE.toUpperCase()})`);
    assertInert(html);
    expect(html).toContain(`<a class="paste-att" data-att="${FILE}">the doc</a>`);
    expect(html).toContain(`<a class="paste-att" data-att="${FILE}">x</a>`);
  });

  it("renders an unknown or malformed reference as a placeholder", () => {
    const html = render(`![x](attachment:${"c".repeat(64)}) [y](attachment:nothex)`);
    assertInert(html);
    expect(html).not.toContain("<img");
    expect(html.match(/class="paste-missing"/g)?.length).toBe(2);
  });

  it("lists the attachment hashes referenced in link and image destinations", () => {
    expect(attachmentRefs(`![a](attachment:${IMG}) [b](attachment:${FILE}) \`attachment:${"d".repeat(64)}\``).sort()).toEqual([IMG, FILE]);
  });
});

describe("REQ-PASTE-027 allow-list verifier", () => {
  it("accepts the renderer's own output", () => {
    expect(isSafePasteHtml("<p>hi <strong>there</strong></p>\n", ORIGIN)).toBe(true);
  });

  for (const html of [
    "<script>alert(1)</script>",
    '<p onclick="x">a</p>',
    '<p style="color:red">a</p>',
    '<h1 id="settings">x</h1>',
    '<a href="javascript:alert(1)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">x</a>',
    '<a href="jav&#x61;script:alert(1)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">x</a>',
    '<a href="https://ok.example">no rel</a>',
    '<img src="https://tracker.example/p.png" alt="">',
    '<img src="blob:https://evil.example/1" alt="">',
    "<img src=blob:x>",
    "<p class='paste-att'>x</p>",
    '<span class="other">x</span>',
    '<a class="paste-att" data-att="xyz">x</a>',
    '<input type="text">',
    "<iframe></iframe>",
    "<p>unterminated <",
    '<p title="a" title="b">x</p>',
    '<div class="mermaid">x</div>',
  ]) {
    it(`rejects ${html}`, () => {
      expect(isSafePasteHtml(html, ORIGIN)).toBe(false);
    });
  }

  it("falls back to null (show source) when the output is not safe", () => {
    expect(renderPasteSafely("# ok", resolve, { origin: ORIGIN })).toContain("<h1>ok</h1>");
    const evilResolve = (): AttachmentView => ({ kind: "image", url: "https://tracker.example/p.png", width: 1, height: 1 });
    expect(renderPasteSafely(`![x](attachment:${IMG})`, evilResolve, { origin: ORIGIN })).toBeNull();
  });
});
