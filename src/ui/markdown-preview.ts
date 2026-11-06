/**
 * Markdown of received files (preview of `.md` files): untrusted content, so it goes
 * through the paste board's strict renderer (`src/paste/markdown.ts`) — raw HTML shown
 * as text, only http/https/mailto links (new tab, no referrer), remote images as
 * click-to-open chips (never loaded), no heading ids, no Mermaid — and its allow-list
 * check. `attachment:` references mean nothing outside a paste: they are placeholders.
 * Null when the output fails the check: callers show the source instead.
 */
import { renderPasteSafely, type PasteMarkdownOptions } from "@/paste/markdown";

export function renderReceivedMarkdown(markdown: string, opts: PasteMarkdownOptions = {}): string | null {
  return renderPasteSafely(markdown, () => ({ kind: "missing" }), opts);
}
