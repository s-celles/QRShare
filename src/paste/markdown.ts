/**
 * Markdown renderer for untrusted pastes (REQ-PASTE-024 to 028, 045).
 *
 * Unlike `src/ui/markdown.ts` (trusted docs), every token's output is controlled:
 * raw HTML is shown as text, headings carry no id, code is never handed to Mermaid,
 * only http/https/mailto links stay clickable (new tab, no referrer), remote images
 * become link chips (never loaded) and `attachment:<sha256>` references are resolved
 * by the caller. The result is then checked by `isSafePasteHtml`, an allow-list
 * verifier that fails closed: callers show the source when it rejects the output.
 */
import { Marked, type Token, type Tokens } from "marked";

export type AttachmentView =
  | { kind: "image"; url: string; alt?: string; width: number; height: number }
  | { kind: "file"; hash: string }
  | { kind: "missing" };

export interface PasteMarkdownOptions {
  /** Origin that `blob:` image sources must belong to (default: the page's). */
  origin?: string;
  labels?: { remoteImage?: (host: string) => string; missing?: string };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ATTACHMENT = /^attachment:([0-9a-f]{64})$/i;
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const EXTERNAL = ' target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"';

/** The normalised URL when it is an absolute http, https or mailto address. */
export function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!/^(https?|mailto):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return SAFE_SCHEMES.has(url.protocol.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

/** The hash of an `attachment:` reference, "" when the reference is malformed, null otherwise. */
function attachmentHash(href: string): string | null {
  const trimmed = href.trim();
  if (!/^attachment:/i.test(trimmed)) return null;
  const m = ATTACHMENT.exec(trimmed);
  return m ? m[1].toLowerCase() : "";
}

export function renderPasteMarkdown(source: string, resolve: (hashHex: string) => AttachmentView, opts: PasteMarkdownOptions = {}): string {
  const remoteLabel = opts.labels?.remoteImage ?? ((host: string) => `remote image: ${host}`);
  const missingLabel = opts.labels?.missing ?? "missing attachment";
  const missing = (text: string) => `<span class="paste-missing">${text ? `${text} ` : ""}[${escapeHtml(missingLabel)}]</span>`;
  const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      heading({ tokens, depth }) {
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      code({ text }) {
        return `<pre><code>${escapeHtml(text.replace(/\n$/, ""))}\n</code></pre>\n`;
      },
      codespan({ text }) {
        return `<code>${escapeHtml(text)}</code>`;
      },
      checkbox({ checked }) {
        return `<input type="checkbox" disabled=""${checked ? ' checked=""' : ""}> `;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const hash = attachmentHash(href);
        if (hash === "") return missing(text);
        if (hash) return resolve(hash).kind === "missing" ? missing(text) : `<a class="paste-att" data-att="${hash}">${text}</a>`;
        const url = safeUrl(href);
        if (!url) return text;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(url)}"${titleAttr}${EXTERNAL}>${text}</a>`;
      },
      image({ href, text }) {
        const alt = escapeHtml(text);
        const hash = attachmentHash(href);
        if (hash === "") return missing(alt);
        if (hash) {
          const view = resolve(hash);
          if (view.kind === "image") {
            const size = view.width > 0 && view.height > 0 ? ` width="${view.width}" height="${view.height}"` : "";
            return `<img src="${escapeHtml(view.url)}" alt="${alt}"${size} loading="lazy" decoding="async">`;
          }
          if (view.kind === "file") return `<a class="paste-att" data-att="${hash}">${alt || hash.slice(0, 12)}</a>`;
          return missing(alt);
        }
        const url = safeUrl(href);
        if (!url || url.startsWith("mailto:")) return alt;
        return `<a class="paste-remote" href="${escapeHtml(url)}"${EXTERNAL}>${escapeHtml(remoteLabel(new URL(url).host))}</a>`;
      },
    },
  });
  return marked.parse(source, { async: false });
}

/** The lower-case hashes referenced by `attachment:` link and image destinations. */
export function attachmentRefs(source: string): string[] {
  const found = new Set<string>();
  const marked = new Marked({ gfm: true, breaks: true });
  marked.walkTokens(marked.lexer(source), (token: Token) => {
    if (token.type === "link" || token.type === "image") {
      const hash = attachmentHash((token as Tokens.Link | Tokens.Image).href);
      if (hash) found.add(hash);
    }
  });
  return [...found];
}

// ---------------------------------------------------------------------------
// Allow-list verifier

const ELEMENTS = new Set("p br hr h1 h2 h3 h4 h5 h6 strong em del code pre blockquote ul ol li table thead tbody tr th td a img input span".split(" "));
const VOID = new Set(["br", "hr", "img", "input"]);
const CLASSES = new Set(["paste-att", "paste-remote", "paste-missing"]);

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function attributeOk(tag: string, name: string, value: string, origin: string | undefined): boolean {
  const raw = decodeEntities(value);
  switch (name) {
    case "href":
      return tag === "a" && safeUrl(raw) === raw;
    case "title":
      return tag === "a";
    case "target":
      return tag === "a" && value === "_blank";
    case "rel":
      return tag === "a" && value === "noopener noreferrer";
    case "referrerpolicy":
      return tag === "a" && value === "no-referrer";
    case "class":
      return (tag === "a" || tag === "span") && CLASSES.has(value);
    case "data-att":
      return tag === "a" && /^[0-9a-f]{64}$/.test(value);
    case "src":
      return tag === "img" && /^blob:[^\s"'<>]+$/.test(raw) && (!origin || raw.startsWith(`blob:${origin}/`));
    case "alt":
      return tag === "img";
    case "width":
    case "height":
      return tag === "img" && /^\d{1,5}$/.test(value);
    case "loading":
      return tag === "img" && value === "lazy";
    case "decoding":
      return tag === "img" && value === "async";
    case "align":
      return (tag === "th" || tag === "td") && /^(left|center|right)$/.test(value);
    case "start":
      return tag === "ol" && /^\d{1,9}$/.test(value);
    case "type":
      return tag === "input" && value === "checkbox";
    case "checked":
    case "disabled":
      return tag === "input" && value === "";
    default:
      return false;
  }
}

const TAG = /^<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z-]*="[^"<>]*")*)\s*>/;
const ATTR = /\s+([a-z][a-z-]*)="([^"<>]*)"/g;

/** Whether `html` only contains allowed elements and attributes, well formed (fail closed). */
export function isSafePasteHtml(html: string, origin: string | undefined = globalThis.location?.origin): boolean {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    const m = TAG.exec(html.slice(lt));
    if (!m) return false;
    const [whole, closing, tag, attrs] = m;
    if (!ELEMENTS.has(tag)) return false;
    if (closing) {
      if (attrs || VOID.has(tag)) return false;
    } else {
      const seen = new Map<string, string>();
      for (const [, name, value] of attrs.matchAll(ATTR)) {
        if (seen.has(name) || !attributeOk(tag, name, value, origin)) return false;
        seen.set(name, value);
      }
      if (tag === "a") {
        const link = seen.has("href");
        const chip = seen.has("data-att");
        if (link === chip) return false;
        if (link && (seen.get("target") !== "_blank" || seen.get("rel") !== "noopener noreferrer" || seen.get("referrerpolicy") !== "no-referrer")) return false;
        if (link && seen.has("class") && seen.get("class") !== "paste-remote") return false;
        if (chip && seen.get("class") !== "paste-att") return false;
      }
      if (tag === "img" && !seen.has("src")) return false;
      if (tag === "input" && (seen.get("type") !== "checkbox" || !seen.has("disabled"))) return false;
    }
    i = lt + whole.length;
  }
  return true;
}

/** Rendered HTML, or null when it fails the allow-list check (show the source then, REQ-PASTE-027). */
export function renderPasteSafely(source: string, resolve: (hashHex: string) => AttachmentView, opts: PasteMarkdownOptions = {}): string | null {
  try {
    const html = renderPasteMarkdown(source, resolve, opts);
    return isSafePasteHtml(html, opts.origin ?? globalThis.location?.origin) ? html : null;
  } catch {
    return null;
  }
}
