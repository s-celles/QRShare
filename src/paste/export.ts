/**
 * Board export (REQ-PASTE-100 to 107): a deterministic Markdown document, and a
 * ZIP with the attachments, statements, signatures and proofs.
 *
 * The document opens with a YAML frontmatter holding the technical details of every
 * paste (ids, fingerprints, hashes, proof state, attachments); each paste in the body
 * keeps a short header (pseudonym, declared time, notable proof state, attachment links).
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

/** A few words in the paste header when the proof state is worth noting; details are in the frontmatter. */
function proofNote(summary: ProofSummary | undefined, verified: number[]): string | null {
  if (!summary || summary.status === "none") return null;
  if (summary.status === "bitcoin") {
    return summary.heights.some((h) => verified.includes(h)) ? "confirmed in Bitcoin (checked)" : "Bitcoin claimed, not verified";
  }
  return "pending";
}

/** Characters escaped in the frontmatter (and replaced in generated body lines). */
const UNSAFE = /[\p{C}\p{Zl}\p{Zp}]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * A YAML double-quoted scalar that is also a JSON string (REQ-PASTE-107): JSON escaping,
 * plus `\uXXXX` for every other control, format (BOM, bidi), separator, private-use or
 * unassigned BMP character, so the value stays on one line and can never close the
 * frontmatter. Lone surrogates become U+FFFD (they cannot be encoded in UTF-8 anyway);
 * astral characters are left as is (all printable in YAML).
 */
export function yamlString(text: string): string {
  return JSON.stringify(text.replace(LONE_SURROGATE, "\uFFFD")).replace(UNSAFE, (c) => {
    const code = c.codePointAt(0)!;
    return code > 0xffff ? c : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

type YamlScalar = string | number | boolean;
const yamlValue = (v: YamlScalar | YamlScalar[]): string =>
  Array.isArray(v) ? `[${v.map(yamlValue).join(", ")}]` : typeof v === "string" ? yamlString(v) : String(v);

/** Line breaks, controls, BOM and bidi overrides/isolates: replaced in generated body text. */
const BREAKING = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/** One line of generated Markdown text (names in headers): no line break or bidi control, Markdown escaped. */
const inline = (text: string) => escapeMarkdown(text.replace(LONE_SURROGATE, "\uFFFD").replace(BREAKING, "\uFFFD"));

interface ExportedAttachment {
  ref: AttachmentRef;
  hex: string;
  /** ZIP path when the file is included. */
  path?: string;
}

function attachmentsOf(paste: Paste, opts: ExportOptions, paths: Map<string, string>): ExportedAttachment[] {
  return paste.attachments.map((ref) => {
    const hex = toHex(ref.hash);
    const included = opts.attachments === "links" && (opts.included?.(hex) ?? true);
    return { ref, hex, path: included ? (paths.get(hex) ?? attachmentPath(ref)) : undefined };
  });
}

/** YAML frontmatter with the technical details of every paste (REQ-PASTE-107). */
function frontmatter(sorted: Paste[], opts: ExportOptions, paths: Map<string, string>, attachmentCount: number): string[] {
  const out = [
    "---",
    "qrshare_export: 1",
    `export_type: ${yamlValue("paste-board")}`,
    `exported_at: ${yamlValue(new Date(opts.exportedAt).toISOString())}`,
    `paste_count: ${sorted.length}`,
    `attachment_count: ${attachmentCount}`,
  ];
  if (!sorted.length) out.push("pastes: []");
  else out.push("pastes:");
  for (const paste of sorted) {
    const id = toHex(paste.id);
    const summary = opts.proofs.get(id);
    const verified = opts.verifiedHeights?.get(id) ?? [];
    const heights = summary?.heights ?? [];
    const field = (key: string, v: YamlScalar | YamlScalar[], indent = "    ") => out.push(`${indent}${key}: ${yamlValue(v)}`);
    out.push(`  - id: ${yamlValue(id)}`);
    field("author", paste.authorName);
    field("fingerprint", paste.authorFp);
    field("author_key", toHex(paste.author));
    field("declared_at", new Date(paste.declaredAt).toISOString());
    field("declared_at_self_declared", true);
    field("future", paste.future);
    field("format", paste.format === "markdown" ? "markdown" : "plain");
    field("source_sha256", toHex(paste.sourceHash));
    field("signature", "valid");
    field("signature_algorithm", "Ed25519");
    out.push("    proof:");
    field("status", summary?.status ?? "none", "      ");
    field("pending_calendars", summary?.calendars ?? [], "      ");
    field("bitcoin_verified", heights.filter((h) => verified.includes(h)), "      ");
    field("bitcoin_claimed", heights.filter((h) => !verified.includes(h)), "      ");
    const atts = attachmentsOf(paste, opts, paths);
    if (!atts.length) out.push("    attachments: []");
    else out.push("    attachments:");
    for (const a of atts) {
      out.push(`      - name: ${yamlValue(a.ref.name)}`);
      field("mime", a.ref.mime, "        ");
      field("size", a.ref.size, "        ");
      field("sha256", a.hex, "        ");
      field("included", a.path !== undefined, "        ");
      if (a.path !== undefined) field("path", a.path, "        ");
    }
  }
  out.push("---");
  return out;
}

export function exportBoardMarkdown(pastes: Paste[], opts: ExportOptions): string {
  const sorted = sortedForExport(pastes);
  const paths = canonicalPaths(sorted);
  const attachmentCount = new Set(sorted.flatMap((p) => p.attachments.map((a) => toHex(a.hash)))).size;
  const out: string[] = [
    ...frontmatter(sorted, opts, paths, attachmentCount),
    "",
    "# QRShare paste board export",
    "",
    `- Exported: ${new Date(opts.exportedAt).toISOString()} (this device's clock)`,
    `- Pastes: ${sorted.length} · Attachments: ${attachmentCount}`,
    "- Timestamps are declared by each author's device and are not verified.",
    "- Signatures were verified by the exporting device. Room code and keys are not included.",
    "- Paste ids, fingerprints, hashes and proof details are in the YAML frontmatter above.",
    "",
  ];
  sorted.forEach((paste, i) => {
    const id = toHex(paste.id);
    out.push("---", "", `## Paste ${i + 1} · ${inline(paste.authorName)}`, "");
    out.push(`- Declared: ${new Date(paste.declaredAt).toISOString()} (self-declared${paste.future ? ", in the future" : ""})`);
    const note = proofNote(opts.proofs.get(id), opts.verifiedHeights?.get(id) ?? []);
    if (note) out.push(`- OpenTimestamps: ${note}`);
    const atts = attachmentsOf(paste, opts, paths);
    if (atts.length) {
      const items = atts.map((a) => (a.path ? `[${inline(a.ref.name)}](${encodePath(a.path)})` : `${inline(a.ref.name)} (not included)`));
      out.push(`- Attachments: ${items.join(", ")}`);
    }
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
