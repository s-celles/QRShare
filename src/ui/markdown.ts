/**
 * Minimal markdown-to-HTML converter.
 * Handles only the subset used in the user guides:
 * headings, bold, links, lists (ordered/unordered), horizontal rules,
 * fenced code blocks (with mermaid support), paragraphs.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  function closeLists(): void {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  }

  function inline(text: string): string {
    // Bold: **text**
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Links: [text](url)
    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    return text;
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block handling
    if (inCodeBlock) {
      if (/^```\s*$/.test(line)) {
        // Close code block
        const content = codeBlockLines.join("\n");
        if (codeBlockLang === "mermaid") {
          out.push(`<div class="mermaid">${content}</div>`);
        } else {
          out.push(`<pre><code>${escapeHtml(content)}</code></pre>`);
        }
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
      continue;
    }

    // Opening fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      closeLists();
      inCodeBlock = true;
      codeBlockLang = fenceMatch[1] || "";
      codeBlockLines = [];
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      closeLists();
      out.push("<hr>");
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1].length;
      const text = inline(headingMatch[2]);
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    // Unordered list item (top-level or indented)
    const ulMatch = line.match(/^(\s*)- (.+)$/);
    if (ulMatch) {
      if (!inUl) {
        if (inOl) {
          out.push("</ol>");
          inOl = false;
        }
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ulMatch[2])}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inOl) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(olMatch[1])}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeLists();
      continue;
    }

    // Paragraph
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeLists();
  return out.join("\n");
}
