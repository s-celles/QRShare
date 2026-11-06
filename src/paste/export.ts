/**
 * Board export (REQ-PASTE-100 to 106): a deterministic Markdown document, and a
 * ZIP with the attachments, statements, signatures and proofs.
 *
 * Markdown pastes are embedded as block quotes (every line prefixed), so headings,
 * thematic breaks and unclosed fences stay inside the quote; raw HTML found by
 * marked's lexer is escaped; `attachment:` destinations of links, images and
 * definitions are rewritten (code is left untouched). Plain-text pastes go into a
 * fence longer than any backtick run of the content.
 */
import { Lexer, type Token } from "marked";
import { bundleFiles, type FileEntry } from "@/zip/bundle";
import type { Paste } from "./board";
import { compareBytes } from "./frames";
import { toHex } from "./keys";
import type { ProofSummary } from "./ots/file";
import type { AttachmentRef } from "./statement";

export interface ExportOptions {
  /** This device's clock at export time (ms). */
  exportedAt: number;
  /** Rewrite attachment references to `attachments/…` paths or to placeholders. */
  attachments: "links" | "placeholders";
  /** Proof state per paste id (hex). */
  proofs: Map<string, ProofSummary>;
  /** With "links": whether an attachment is included (placeholder otherwise). */
  included?: (hashHex: string) => boolean;
  /**
   * Bitcoin heights checked against a block explorer, per paste id (hex). Other
   * Bitcoin attestations are reported as claimed, not verified.
   */
  verifiedHeights?: Map<string, number[]>;
}

const ATTACHMENT = /^attachment:([0-9a-f]{64})$/i;

/** Escapes Markdown syntax in generated text such as file names. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|#&!]/g, (c) => `\\${c}`);
}

/** A backtick fence longer than any backtick run of `text` (at least 3). */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function attachmentPath(ref: AttachmentRef): string {
  return `attachments/${toHex(ref.hash)}-${ref.name}`;
}

const encodePath = (path: string) =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/\(/g, "%28").replace(/\)/g, "%29"))
    .join("/");

const placeholder = (ref: AttachmentRef | undefined, hex: string) =>
  ref ? `\\[attachment "${escapeMarkdown(ref.name)}" not included, SHA-256 ${hex}\\]` : `\\[unknown attachment, SHA-256 ${hex}\\]`;

/** One path per attachment hash (the first name in export order), shared by every link. */
function canonicalPaths(sorted: Paste[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const p of sorted) for (const a of p.attachments) if (!paths.has(toHex(a.hash))) paths.set(toHex(a.hash), attachmentPath(a));
  return paths;
}

function sortedForExport(pastes: Paste[]): Paste[] {
  return [...pastes].sort((a, b) => a.declaredAt - b.declaredAt || compareBytes(a.id, b.id));
}

function childTokens(token: Token): Token[] {
  const t = token as Token & { tokens?: Token[]; items?: Token[]; header?: { tokens: Token[] }[]; rows?: { tokens: Token[] }[][] };
  if (t.type === "table") return [...(t.header ?? []).flatMap((c) => c.tokens), ...(t.rows ?? []).flat().flatMap((c) => c.tokens)];
  return t.items ?? t.tokens ?? [];
}

/** The Markdown source with raw HTML escaped and attachment destinations rewritten. */
function rewriteSource(source: string, paste: Paste, opts: ExportOptions, paths: Map<string, string>): string {
  const refOf = (hex: string) => paste.attachments.find((a) => toHex(a.hash) === hex);
  const linked = (hex: string) => opts.attachments === "links" && !!refOf(hex) && (opts.included?.(hex) ?? true);
  const destination = (hex: string) => (linked(hex) ? encodePath(paths.get(hex) ?? attachmentPath(refOf(hex)!)) : `#attachment-${hex}`);
  const escapeHtml = (raw: string) => raw.replace(/</g, "&lt;");
  const fallback = (raw: string) => escapeHtml(raw).replace(/attachment:([0-9a-f]{64})/gi, (_, h: string) => destination(h.toLowerCase()));

  const transform = (token: Token): string => {
    switch (token.type) {
      case "html":
        return escapeHtml(token.raw);
      case "code":
      case "codespan":
        return token.raw;
      case "def": {
        const m = ATTACHMENT.exec(token.href.trim());
        return m ? token.raw.replace(/attachment:[0-9a-f]{64}/i, destination(m[1].toLowerCase())) : token.raw;
      }
      case "link":
      case "image": {
        const m = ATTACHMENT.exec(token.href.trim());
        if (m) {
          const hex = m[1].toLowerCase();
          if (!linked(hex)) return placeholder(refOf(hex), hex);
          const raw = patch(token);
          const at = raw.toLowerCase().lastIndexOf(`attachment:${hex}`);
          return at < 0 ? fallback(token.raw) : raw.slice(0, at) + destination(hex) + raw.slice(at + 75);
        }
        return patch(token);
      }
      default:
        return patch(token);
    }
  };

  // Rebuilds a token's raw text with its children transformed, in order.
  const patch = (token: Token): string => {
    const raw = token.raw;
    let out = "";
    let pos = 0;
    for (const child of childTokens(token)) {
      const next = transform(child);
      if (next === child.raw) continue;
      const at = raw.indexOf(child.raw, pos);
      if (at < 0 || !child.raw) return fallback(raw);
      out += raw.slice(pos, at) + next;
      pos = at + child.raw.length;
    }
    return out + raw.slice(pos);
  };

  const tokens = new Lexer({ gfm: true, breaks: true }).lex(source);
  if (tokens.map((t) => t.raw).join("") !== source) return fallback(source);
  return tokens.map(transform).join("");
}

function quote(text: string): string {
  return text
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function proofLine(summary: ProofSummary | undefined, verified: number[]): string {
  if (!summary || summary.status === "none") return "none";
  if (summary.status === "bitcoin") {
    const checked = summary.heights.filter((h) => verified.includes(h));
    const claimed = summary.heights.filter((h) => !verified.includes(h));
    const parts: string[] = [];
    if (checked.length) parts.push(`confirmed, Bitcoin block ${checked.join(", ")} (checked against a block explorer)`);
    if (claimed.length) parts.push(`Bitcoin block ${claimed.join(", ")} claimed, not verified by the exporting device`);
    return parts.join("; ");
  }
  return `pending (${summary.calendars.length} calendar${summary.calendars.length === 1 ? "" : "s"})`;
}

export function exportBoardMarkdown(pastes: Paste[], opts: ExportOptions): string {
  const sorted = sortedForExport(pastes);
  const paths = canonicalPaths(sorted);
  const attachmentCount = new Set(sorted.flatMap((p) => p.attachments.map((a) => toHex(a.hash)))).size;
  const out: string[] = [
    "# QRShare paste board export",
    "",
    `- Exported: ${new Date(opts.exportedAt).toISOString()} (this device's clock)`,
    `- Pastes: ${sorted.length} · Attachments: ${attachmentCount}`,
    "- Timestamps are declared by each author's device and are not verified.",
    "- Signatures were verified by the exporting device. Room code and keys are not included.",
    "",
  ];
  sorted.forEach((paste, i) => {
    const id = toHex(paste.id);
    out.push("---", "", `## Paste ${i + 1} · ${paste.authorName} (${paste.authorFp})`, "");
    out.push(`- Declared: ${new Date(paste.declaredAt).toISOString()} (self-declared)`);
    out.push(`- Format: ${paste.format === "markdown" ? "Markdown" : "Plain text"}`);
    out.push(`- Paste id: \`${id}\``);
    out.push(`- Source SHA-256: \`${toHex(paste.sourceHash)}\``);
    out.push(`- Signature: valid (Ed25519, key \`${toHex(paste.author)}\`)`);
    out.push(`- OpenTimestamps: ${proofLine(opts.proofs.get(id), opts.verifiedHeights?.get(id) ?? [])}`);
    if (paste.attachments.length) {
      out.push("- Attachments:");
      for (const a of paste.attachments) out.push(`  - ${escapeMarkdown(a.name)} (${escapeMarkdown(a.mime)}, ${a.size} bytes, SHA-256 \`${toHex(a.hash)}\`)`);
    } else out.push("- Attachments: none");
    out.push("");
    if (paste.format === "markdown") {
      out.push(quote(rewriteSource(paste.source, paste, opts, paths)));
    } else {
      const fence = fenceFor(paste.source);
      out.push(`${fence}text`, paste.source.replace(/\n$/, ""), fence);
    }
    out.push("");
  });
  return out.join("\n");
}

export function exportBoardZip(
  pastes: Paste[],
  blobs: (hashHex: string) => Uint8Array | undefined,
  opts: { exportedAt: number; proofs: Map<string, ProofSummary>; verifiedHeights?: Map<string, number[]> },
): Uint8Array {
  const sorted = sortedForExport(pastes);
  const files: FileEntry[] = [];
  const included = new Set<string>();
  for (const [hex, path] of canonicalPaths(sorted)) {
    const bytes = blobs(hex);
    if (!bytes) continue;
    included.add(hex);
    files.push({ name: path, data: bytes });
  }
  const md = exportBoardMarkdown(sorted, { ...opts, attachments: "links", included: (hex) => included.has(hex) });
  const proofs: FileEntry[] = sorted.flatMap((p) => {
    const base = `proofs/paste-${toHex(p.id)}.statement`;
    const entries = [
      { name: base, data: p.statement },
      { name: `${base}.sig`, data: p.signature },
    ];
    if (p.proof) entries.push({ name: `${base}.ots`, data: p.proof });
    return entries;
  });
  return bundleFiles([{ name: "board.md", data: new TextEncoder().encode(md) }, ...files, ...proofs], { mtime: opts.exportedAt });
}

/** `qrshare-paste-board-20261105T221000Z.md` (REQ-PASTE-106). */
export function exportFileName(exportedAt: number, ext: "md" | "zip"): string {
  const stamp = new Date(exportedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `qrshare-paste-board-${stamp}.${ext}`;
}
