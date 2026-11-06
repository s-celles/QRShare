import { describe, expect, it } from "bun:test";
import { Lexer, Marked } from "marked";
import { unzipSync } from "fflate";
import type { Paste } from "@/paste/board";
import { exportBoardMarkdown, exportBoardZip, exportFileName, fenceFor, yamlString } from "@/paste/export";
import { parseFrontmatter } from "@/ui/frontmatter";
import { toHex } from "@/paste/keys";
import type { ProofSummary } from "@/paste/ots/file";
import { SECRET, roomKeys } from "./helpers";

const EXPORTED_AT = Date.UTC(2026, 10, 5, 22, 10, 0);
const H = (n: number) => new Uint8Array(32).fill(n);
const IMG = H(0xaa);
const DOC = H(0xbb);

function paste(n: number, over: Partial<Paste>): Paste {
  return {
    id: H(n),
    statement: new Uint8Array([0x51, n]),
    signature: new Uint8Array(64).fill(n),
    author: H(0x40 + n),
    authorFp: "a1b2c3d" + n,
    authorName: "Swift Crimson Falcon",
    authorColor: "#b8173a",
    declaredAt: Date.UTC(2026, 10, 5, 21, 0, n),
    receivedAt: 0,
    format: "markdown",
    source: "hello",
    sourceHash: H(0x80 + n),
    attachments: [],
    own: false,
    future: false,
    proofSource: "none",
    proofStatus: "none",
    ...over,
  };
}

const board = (): Paste[] => [
  paste(3, {
    source: `# A heading\n![photo](attachment:${toHex(IMG)}) and [doc](attachment:${toHex(DOC)}) and \`attachment:${toHex(IMG)}\`\n\n<script>alert(1)</script>\n\n[ref]: attachment:${toHex(DOC)}`,
    attachments: [
      { hash: IMG, size: 120345, mime: "image/webp", name: "photo.webp", width: 10, height: 10 },
      { hash: DOC, size: 42, mime: "application/pdf", name: "my [report]_v2.pdf", width: 0, height: 0 },
    ],
    proof: new Uint8Array([1, 2, 3]),
    proofStatus: "pending",
  }),
  paste(1, { format: "text", source: "plain ``` text with ```` runs`" }),
  paste(2, {
    source: "# h\nsetext\n===\n---\n## Paste 9 · Fake (deadbeef)\n```\nunclosed fence\n<script>alert(2)</script>",
    declaredAt: Date.UTC(2026, 10, 5, 21, 0, 1), // same as paste 1: tie broken by id
    proof: new Uint8Array([4]),
    proofStatus: "bitcoin",
  }),
];

/** The YAML between the opening and closing `---` lines (REQ-PASTE-107). */
function frontmatterOf(md: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no frontmatter");
  return m[1];
}
const bodyOf = (md: string) => md.slice(frontmatterOf(md).length + 9);

const proofs = new Map<string, ProofSummary>([
  [toHex(H(3)), { status: "pending", calendars: ["https://a", "https://b"], heights: [], unsupported: false }],
  [toHex(H(2)), { status: "bitcoin", calendars: [], heights: [912345], unsupported: false }],
]);

describe("REQ-PASTE-100..105 Markdown export body", () => {
  const md = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs });

  it("is deterministic across runs and input orders", () => {
    expect(exportBoardMarkdown([...board()].reverse(), { exportedAt: EXPORTED_AT, attachments: "links", proofs })).toBe(md);
    expect(exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs })).toBe(md);
  });

  it("starts with the export header, in UTC", () => {
    expect(bodyOf(md).startsWith("\n# QRShare paste board export\n\n- Exported: 2026-11-05T22:10:00.000Z (this device's clock)\n- Pastes: 3 · Attachments: 2\n")).toBe(true);
    expect(md).toContain("- Timestamps are declared by each author's device and are not verified.");
  });

  it("lists pastes in chronological order, ties by id, with short headers", () => {
    const headers = [...md.matchAll(/^## Paste (\d+) · (.+)$/gm)].map((m) => m[0]);
    expect(headers).toEqual(["## Paste 1 · Swift Crimson Falcon", "## Paste 2 · Swift Crimson Falcon", "## Paste 3 · Swift Crimson Falcon"]);
    expect(bodyOf(md)).toContain("## Paste 1 · Swift Crimson Falcon\n\n- Declared: 2026-11-05T21:00:01.000Z (self-declared)\n\n`````text");
    expect(bodyOf(md)).toContain("## Paste 2 · Swift Crimson Falcon\n\n- Declared: 2026-11-05T21:00:01.000Z (self-declared)\n- OpenTimestamps: Bitcoin claimed, not verified\n\n> # h");
    expect(bodyOf(md)).toContain("- OpenTimestamps: pending\n");
    expect(bodyOf(md)).toContain(
      `- Attachments: [photo.webp](attachments/${toHex(IMG)}-photo.webp), [my \\[report\\]\\_v2.pdf](attachments/${toHex(DOC)}-my%20%5Breport%5D_v2.pdf)\n`,
    );
  });

  it("REQ-PASTE-101 keeps technical details out of the body (frontmatter only)", () => {
    const body = bodyOf(md);
    for (const detail of [toHex(H(1)), toHex(H(0x81)), toHex(H(0x41)), "a1b2c3d1", "image/webp", "120345", "https://a", "912345"]) {
      expect(body).not.toContain(detail);
      expect(frontmatterOf(md)).toContain(detail);
    }
  });

  it("marks future-dated pastes and replaces line breaks and bidi controls in names", () => {
    const out = exportBoardMarkdown(
      [paste(1, { future: true, format: "text", authorName: "Evil\n## Paste 9 · \u202Eforged", attachments: [{ hash: IMG, size: 1, mime: "x", name: "a\nb.txt", width: 0, height: 0 }] })],
      { exportedAt: EXPORTED_AT, attachments: "placeholders", proofs: new Map() },
    );
    expect(bodyOf(out)).toContain("## Paste 1 · Evil\uFFFD\\#\\# Paste 9 · \uFFFDforged\n\n- Declared: 2026-11-05T21:00:01.000Z (self-declared, in the future)\n- Attachments: a\uFFFDb.txt (not included)\n");
    expect([...bodyOf(out).matchAll(/^## /gm)].length).toBe(1);
  });

  it("fences plain text with a fence longer than any backtick run", () => {
    expect(md).toContain("`````text\nplain ``` text with ```` runs`\n`````\n");
    expect(fenceFor("no backticks")).toBe("```");
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("ends with ``````")).toBe("```````");
  });

  it("keeps every Markdown paste inside its quote and escapes raw HTML", () => {
    const tokens = new Lexer({ gfm: true }).lex(bodyOf(md));
    const headings = tokens.filter((t) => t.type === "heading") as { depth: number; text: string }[];
    expect(headings.filter((h) => h.depth === 1).length).toBe(1);
    expect(headings.filter((h) => h.depth === 2).map((h) => h.text)).toEqual([
      "Paste 1 · Swift Crimson Falcon",
      "Paste 2 · Swift Crimson Falcon",
      "Paste 3 · Swift Crimson Falcon",
    ]);
    // no raw HTML anywhere: the second <script> is inside the paste's own (unclosed) code fence
    const html: string[] = [];
    new Marked({ gfm: true }).walkTokens(tokens, (t) => {
      if (t.type === "html") html.push(t.raw);
    });
    expect(html).toEqual([]);
    expect(md).toContain("> ```\n> unclosed fence\n> <script>alert(2)</script>\n\n---");
    expect(md).toContain("> &lt;script>alert(1)&lt;/script>");
    expect(md).toContain("> ## Paste 9 · Fake (deadbeef)");
    expect(md).toContain("> ---");
  });

  it("rewrites attachment destinations only in links, images and definitions", () => {
    expect(md).toContain(`![photo](attachments/${toHex(IMG)}-photo.webp)`);
    expect(md).toContain(`[doc](attachments/${toHex(DOC)}-my%20%5Breport%5D_v2.pdf)`);
    expect(md).toContain(`[ref]: attachments/${toHex(DOC)}-my%20%5Breport%5D_v2.pdf`);
    expect(md).toContain(`\`attachment:${toHex(IMG)}\``); // code span untouched
  });

  it("uses placeholders in the Markdown-only export", () => {
    const only = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "placeholders", proofs });
    expect(only).toContain(`\\[attachment "photo.webp" not included, SHA-256 ${toHex(IMG)}\\]`);
    expect(only).not.toContain("attachments/");
    expect(only).toContain(`\`attachment:${toHex(IMG)}\``);
  });

  it("REQ-PASTE-103 never includes the room code, secret, derived keys or room tag", async () => {
    const keys = await roomKeys();
    for (const secret of [toHex(SECRET), keys.roomId, keys.password, toHex(keys.tag)]) expect(md).not.toContain(secret);
  });
});

describe("REQ-PASTE-101 / REQ-PASTE-107 Bitcoin attestations shown as verified only after a check", () => {
  it("marks heights checked against a block explorer", () => {
    const md = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs, verifiedHeights: new Map([[toHex(H(2)), [912345]]]) });
    expect(bodyOf(md)).toContain("- OpenTimestamps: confirmed in Bitcoin (checked)\n");
    expect(md).not.toContain("claimed, not verified");
  });
});

describe("REQ-PASTE-104 one ZIP entry per attachment hash", () => {
  it("links every reference to the same entry when names differ", () => {
    const same = { hash: IMG, size: 2, mime: "image/webp", width: 1, height: 1 };
    const pastes = [
      paste(1, { source: `![a](attachment:${toHex(IMG)})`, attachments: [{ ...same, name: "first.webp" }] }),
      paste(2, { source: `![b](attachment:${toHex(IMG)})`, attachments: [{ ...same, name: "second.webp" }] }),
    ];
    const files = unzipSync(exportBoardZip(pastes, () => new Uint8Array([1, 2]), { exportedAt: EXPORTED_AT, proofs: new Map() }));
    const entries = Object.keys(files).filter((n) => n.startsWith("attachments/"));
    expect(entries).toEqual([`attachments/${toHex(IMG)}-first.webp`]);
    const md = new TextDecoder().decode(files["board.md"]);
    expect(md).toContain(`![a](attachments/${toHex(IMG)}-first.webp)`);
    expect(md).toContain(`![b](attachments/${toHex(IMG)}-first.webp)`);
  });
});

describe("REQ-PASTE-103 room tag in ZIP statements", () => {
  it("keeps the one-way room tag inside proofs/*.statement (documented), never in board.md", async () => {
    const keys = await roomKeys();
    const statement = new Uint8Array([0x51, 0x50, 0x53, 0x54, 1, ...keys.tag]);
    const files = unzipSync(exportBoardZip([paste(1, { statement })], () => undefined, { exportedAt: EXPORTED_AT, proofs: new Map() }));
    const st = files[`proofs/paste-${toHex(H(1))}.statement`];
    expect(toHex(st.subarray(5, 21))).toBe(toHex(keys.tag));
    expect(new TextDecoder().decode(files["board.md"])).not.toContain(toHex(keys.tag));
  });
});

describe("REQ-PASTE-104 / REQ-PASTE-106 ZIP export", () => {
  it("bundles board.md, attachments and statements with proofs, deterministically", () => {
    const blobs = (hex: string) => (hex === toHex(IMG) ? new Uint8Array([9, 9]) : undefined);
    const zip = exportBoardZip(board(), blobs, { exportedAt: EXPORTED_AT, proofs });
    expect(exportBoardZip([...board()].reverse(), blobs, { exportedAt: EXPORTED_AT, proofs })).toEqual(zip);
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      [
        "board.md",
        `attachments/${toHex(IMG)}-photo.webp`,
        ...[1, 2, 3].flatMap((n) => [`proofs/paste-${toHex(H(n))}.statement`, `proofs/paste-${toHex(H(n))}.statement.sig`]),
        `proofs/paste-${toHex(H(2))}.statement.ots`,
        `proofs/paste-${toHex(H(3))}.statement.ots`,
      ].sort(),
    );
    const md = new TextDecoder().decode(files["board.md"]);
    expect(md).toContain(`![photo](attachments/${toHex(IMG)}-photo.webp)`);
    // the PDF is not available: placeholder instead of a dangling link
    expect(md).toContain(`\\[attachment "my \\[report\\]\\_v2.pdf" not included, SHA-256 ${toHex(DOC)}\\]`);
    expect([...files[`proofs/paste-${toHex(H(3))}.statement.ots`]]).toEqual([1, 2, 3]);
  });

  it("names exports after the UTC export time", () => {
    expect(exportFileName(EXPORTED_AT, "md")).toBe("qrshare-paste-board-20261105T221000Z.md");
    expect(exportFileName(EXPORTED_AT, "zip")).toBe("qrshare-paste-board-20261105T221000Z.zip");
  });
});

describe("REQ-PASTE-107 YAML frontmatter", () => {
  const md = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs, verifiedHeights: new Map([[toHex(H(2)), [7]]]) });
  const yaml = frontmatterOf(md);

  it("opens the document, before the human-readable header", () => {
    expect(md.startsWith("---\nqrshare_export: 1\n")).toBe(true);
    expect(bodyOf(md).startsWith("\n# QRShare paste board export\n")).toBe(true);
  });

  it("parses as YAML into the export metadata, mirroring the paste headers", () => {
    expect(Bun.YAML.parse(yaml)).toEqual({
      qrshare_export: 1,
      export_type: "paste-board",
      exported_at: "2026-11-05T22:10:00.000Z",
      paste_count: 3,
      attachment_count: 2,
      pastes: [
        {
          id: toHex(H(1)),
          author: "Swift Crimson Falcon",
          fingerprint: "a1b2c3d1",
          author_key: toHex(H(0x41)),
          declared_at: "2026-11-05T21:00:01.000Z",
          declared_at_self_declared: true,
          future: false,
          format: "plain",
          source_sha256: toHex(H(0x81)),
          signature: "valid",
          signature_algorithm: "Ed25519",
          proof: { status: "none", pending_calendars: [], bitcoin_verified: [], bitcoin_claimed: [] },
          attachments: [],
        },
        {
          id: toHex(H(2)),
          author: "Swift Crimson Falcon",
          fingerprint: "a1b2c3d2",
          author_key: toHex(H(0x42)),
          declared_at: "2026-11-05T21:00:01.000Z",
          declared_at_self_declared: true,
          future: false,
          format: "markdown",
          source_sha256: toHex(H(0x82)),
          signature: "valid",
          signature_algorithm: "Ed25519",
          proof: { status: "bitcoin", pending_calendars: [], bitcoin_verified: [], bitcoin_claimed: [912345] },
          attachments: [],
        },
        {
          id: toHex(H(3)),
          author: "Swift Crimson Falcon",
          fingerprint: "a1b2c3d3",
          author_key: toHex(H(0x43)),
          declared_at: "2026-11-05T21:00:03.000Z",
          declared_at_self_declared: true,
          future: false,
          format: "markdown",
          source_sha256: toHex(H(0x83)),
          signature: "valid",
          signature_algorithm: "Ed25519",
          proof: { status: "pending", pending_calendars: ["https://a", "https://b"], bitcoin_verified: [], bitcoin_claimed: [] },
          attachments: [
            { name: "photo.webp", mime: "image/webp", size: 120345, sha256: toHex(IMG), included: true, path: `attachments/${toHex(IMG)}-photo.webp` },
            { name: "my [report]_v2.pdf", mime: "application/pdf", size: 42, sha256: toHex(DOC), included: true, path: `attachments/${toHex(DOC)}-my [report]_v2.pdf` },
          ],
        },
      ],
    });
  });

  it("splits verified and claimed Bitcoin heights, and flags future-dated pastes", () => {
    const out = exportBoardMarkdown([paste(1, { future: true })], {
      exportedAt: EXPORTED_AT,
      attachments: "links",
      proofs: new Map([[toHex(H(1)), { status: "bitcoin", calendars: ["https://c"], heights: [5, 9], unsupported: false }]]),
      verifiedHeights: new Map([[toHex(H(1)), [9]]]),
    });
    const [p] = (Bun.YAML.parse(frontmatterOf(out)) as { pastes: Record<string, unknown>[] }).pastes;
    expect(p.future).toBe(true);
    expect(p.proof).toEqual({ status: "bitcoin", pending_calendars: ["https://c"], bitcoin_verified: [9], bitcoin_claimed: [5] });
  });

  it("emits keys as fixed identifiers and every value as JSON (string, number, boolean or array)", () => {
    for (const line of yaml.split("\n")) {
      const m = /^(?: {2})*(- )?([a-z0-9_]+):(?: (.+))?$/.exec(line);
      expect(m).not.toBeNull();
      if (m?.[3] !== undefined) expect(() => JSON.parse(m[3])).not.toThrow();
    }
  });

  it("is an empty list for an empty board", () => {
    const out = exportBoardMarkdown([], { exportedAt: EXPORTED_AT, attachments: "links", proofs: new Map() });
    expect(Bun.YAML.parse(frontmatterOf(out))).toEqual({ qrshare_export: 1, export_type: "paste-board", exported_at: "2026-11-05T22:10:00.000Z", paste_count: 0, attachment_count: 0, pastes: [] });
  });

  it("marks attachments as placeholders in the Markdown-only export (no path)", () => {
    const out = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "placeholders", proofs });
    const atts = (Bun.YAML.parse(frontmatterOf(out)) as { pastes: { attachments: Record<string, unknown>[] }[] }).pastes[2].attachments;
    expect(atts.map((a) => [a.included, "path" in a])).toEqual([[false, false], [false, false]]);
  });

  it("gives the ZIP path of included attachments in board.md", () => {
    const blobs = (hex: string) => (hex === toHex(IMG) ? new Uint8Array([9, 9]) : undefined);
    const files = unzipSync(exportBoardZip(board(), blobs, { exportedAt: EXPORTED_AT, proofs }));
    const inner = new TextDecoder().decode(files["board.md"]);
    const atts = (Bun.YAML.parse(frontmatterOf(inner)) as { pastes: { attachments: Record<string, unknown>[] }[] }).pastes[2].attachments;
    expect(atts[0]).toMatchObject({ included: true, path: `attachments/${toHex(IMG)}-photo.webp` });
    expect(files[atts[0].path as string]).toBeDefined();
    expect(atts[1].included).toBe(false);
    expect("path" in atts[1]).toBe(false);
  });

  const PAYLOADS = [
    "x\n---\n# pwned\n...\nqrshare_export: 2",
    "a: b # c",
    "...",
    "---",
    "line\rbreak",
    "sep\u2028arator\u2029",
    "\uFEFFbom",
    "nul\u0000\u0001\u001f\u007f\u0085",
    "rtl \u202Egnp.exe\u202C \u2066iso\u2069 \u200E\u200F\u061C",
    'quote " and \\ backslash',
    "{ flow: [1] } & *alias !tag %dir @at `tick` |",
    "nonchar \uFFFE\uFFFF private \uE000",
    "emoji 😀 and tag \u{E0041}",
  ];

  it("round-trips untrusted names, MIME types and pseudonyms without breaking out", () => {
    const pastes = PAYLOADS.map((text, i) =>
      paste(i + 1, {
        authorName: text,
        attachments: [{ hash: H(0xc0 + i), size: i, mime: text, name: text, width: 0, height: 0 }],
      }),
    );
    const out = exportBoardMarkdown(pastes, { exportedAt: EXPORTED_AT, attachments: "links", proofs: new Map() });
    const fm = frontmatterOf(out);
    // exactly one closing delimiter: the frontmatter holds one line per generated key
    expect(fm.split("\n").filter((l) => l === "---" || l === "...")).toEqual([]);
    expect(/[\r\u2028\u2029\uFEFF\u0000-\u0008\u000b-\u001f\u007f\u0085\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069\ufffe\uffff]/.test(fm)).toBe(false);
    const parsed = Bun.YAML.parse(fm) as { paste_count: number; pastes: { author: string; attachments: { name: string; mime: string }[] }[] };
    expect(parsed.paste_count).toBe(PAYLOADS.length);
    expect(parsed.pastes.map((p) => p.author)).toEqual(PAYLOADS);
    expect(parsed.pastes.map((p) => p.attachments[0].name)).toEqual(PAYLOADS);
    expect(parsed.pastes.map((p) => p.attachments[0].mime)).toEqual(PAYLOADS);
    // QRShare's own preview finds the same block and the same body
    const { entries, body } = parseFrontmatter(out);
    expect(entries[0]).toEqual({ key: "qrshare_export", value: "1" });
    expect(body.startsWith("\n# QRShare paste board export\n")).toBe(true);
  });

  it("encodes strings as JSON and escapes YAML-unsafe characters", () => {
    expect(yamlString("a\u2028b\uFEFF\u202E\u0085\u007f")).toBe('"a\\u2028b\\ufeff\\u202e\\u0085\\u007f"');
    expect(yamlString("lone \uD800 surrogate")).toBe('"lone \uFFFD surrogate"');
    expect(JSON.parse(yamlString("é 😀 \n"))).toBe("é 😀 \n");
  });
});

describe("frontmatter preview (received .md files)", () => {
  it("shows JSON strings unquoted and keeps every row", () => {
    const { entries, body } = parseFrontmatter('---\ntitle: "a: \\"b\\""\nlist:\n  - id: "x"\n  - id: "y"\nplain: z\n---\nbody');
    expect(entries).toEqual([
      { key: "title", value: 'a: "b"' },
      { key: "list", value: "" },
      { key: "- id", value: "x" },
      { key: "- id", value: "y" },
      { key: "plain", value: "z" },
    ]);
    expect(body).toBe("body");
  });
});
