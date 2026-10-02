/**
 * Markdown to HTML for the bundled documentation (trusted content), with marked.
 * Mermaid code blocks become diagrams; links to other docs/ pages stay in the app,
 * other links open in a new tab.
 */
import { Marked } from "marked";

/** Maps a link target to an in-app address, or returns null to keep it external. */
export type LinkResolver = (href: string) => string | null;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function markdownToHtml(md: string, resolveLink: LinkResolver = () => null): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        // Mermaid reads the diagram from the element's text, so escaping is safe.
        if (lang === "mermaid") return `<div class="mermaid">${escapeHtml(text)}</div>\n`;
        return false;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const internal = resolveLink(href);
        if (internal !== null) return `<a href="${escapeHtml(internal)}"${titleAttr}>${text}</a>`;
        return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  });
  return marked.parse(md, { async: false });
}
