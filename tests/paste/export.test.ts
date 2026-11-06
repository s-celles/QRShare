import { describe, expect, it } from "bun:test";
import { Lexer, Marked } from "marked";
import { unzipSync } from "fflate";
import type { Paste } from "@/paste/board";
import { exportBoardMarkdown, exportBoardZip, exportFileName, fenceFor } from "@/paste/export";
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

const proofs = new Map<string, ProofSummary>([
  [toHex(H(3)), { status: "pending", calendars: ["https://a", "https://b"], heights: [], unsupported: false }],
  [toHex(H(2)), { status: "bitcoin", calendars: [], heights: [912345], unsupported: false }],
]);

describe("REQ-PASTE-100..105 Markdown export", () => {
  const md = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs });

  it("is deterministic across runs and input orders", () => {
    expect(exportBoardMarkdown([...board()].reverse(), { exportedAt: EXPORTED_AT, attachments: "links", proofs })).toBe(md);
    expect(exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs })).toBe(md);
  });

  it("starts with the export header, in UTC", () => {
    expect(md.startsWith("# QRShare paste board export\n\n- Exported: 2026-11-05T22:10:00.000Z (this device's clock)\n- Pastes: 3 · Attachments: 2\n")).toBe(true);
    expect(md).toContain("- Timestamps are declared by each author's device and are not verified.");
  });

  it("lists pastes in chronological order, ties by id, with their headers", () => {
    const headers = [...md.matchAll(/^## Paste (\d+) · (.+)$/gm)].map((m) => m[0]);
    expect(headers).toEqual(["## Paste 1 · Swift Crimson Falcon (a1b2c3d1)", "## Paste 2 · Swift Crimson Falcon (a1b2c3d2)", "## Paste 3 · Swift Crimson Falcon (a1b2c3d3)"]);
    expect(md).toContain("- Declared: 2026-11-05T21:00:01.000Z (self-declared)");
    expect(md).toContain("- Format: Plain text");
    expect(md).toContain("- Format: Markdown");
    expect(md).toContain(`- Paste id: \`${toHex(H(1))}\``);
    expect(md).toContain(`- Source SHA-256: \`${toHex(H(0x81))}\``);
    expect(md).toContain(`- Signature: valid (Ed25519, key \`${toHex(H(0x41))}\`)`);
    expect(md).toContain("- OpenTimestamps: pending (2 calendars)");
    expect(md).toContain("- OpenTimestamps: Bitcoin block 912345 claimed, not verified by the exporting device");
    expect(md).toContain("- OpenTimestamps: none");
    expect(md).toContain(`  - photo.webp (image/webp, 120345 bytes, SHA-256 \`${toHex(IMG)}\`)`);
    expect(md).toContain("  - my \\[report\\]\\_v2.pdf (application/pdf, 42 bytes");
  });

  it("fences plain text with a fence longer than any backtick run", () => {
    expect(md).toContain("`````text\nplain ``` text with ```` runs`\n`````\n");
    expect(fenceFor("no backticks")).toBe("```");
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("ends with ``````")).toBe("```````");
  });

  it("keeps every Markdown paste inside its quote and escapes raw HTML", () => {
    const tokens = new Lexer({ gfm: true }).lex(md);
    const headings = tokens.filter((t) => t.type === "heading") as { depth: number; text: string }[];
    expect(headings.filter((h) => h.depth === 1).length).toBe(1);
    expect(headings.filter((h) => h.depth === 2).map((h) => h.text)).toEqual([
      "Paste 1 · Swift Crimson Falcon (a1b2c3d1)",
      "Paste 2 · Swift Crimson Falcon (a1b2c3d2)",
      "Paste 3 · Swift Crimson Falcon (a1b2c3d3)",
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

describe("REQ-PASTE-101 Bitcoin attestations shown as verified only after a check", () => {
  it("marks heights checked against a block explorer", () => {
    const md = exportBoardMarkdown(board(), { exportedAt: EXPORTED_AT, attachments: "links", proofs, verifiedHeights: new Map([[toHex(H(2)), [912345]]]) });
    expect(md).toContain("- OpenTimestamps: confirmed, Bitcoin block 912345 (checked against a block explorer)");
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
