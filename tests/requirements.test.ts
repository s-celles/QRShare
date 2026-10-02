import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dir, "..");
const spec = readFileSync(join(root, "docs/requirements.md"), "utf8");

const ID = /REQ-[A-Z]+-\d{3}/g;
/** Requirement rows: "| REQ-XXX-000 | M | 0.1.0 | The system shall … |". */
const ROW = /^\| (REQ-[A-Z]+-\d{3}) \| ([MSCW]) \| ([^|]+) \| (.+) \|$/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js)$/.test(name) ? [path] : [];
  });
}

const defined = [...spec.matchAll(ROW)].map((m) => ({ id: m[1], priority: m[2], since: m[3].trim(), text: m[4] }));

describe("requirements specification (docs/requirements.md)", () => {
  it("defines each requirement once", () => {
    const ids = defined.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("writes every requirement in an EARS pattern", () => {
    const ears = /^(The system shall|When .+?, the system shall|While .+?, the system shall|If .+?, then the system shall|Where .+?, the system shall)/;
    expect(defined.filter((r) => !ears.test(r.text)).map((r) => r.id)).toEqual([]);
  });

  it("gives every requirement a release, Unreleased, or a dash (not implemented)", () => {
    expect(defined.filter((r) => !/^(\d+\.\d+\.\d+|Unreleased|—)$/.test(r.since)).map((r) => r.id)).toEqual([]);
  });

  it("defines every requirement ID that the code and tests refer to", () => {
    const ids = new Set(defined.map((r) => r.id));
    const files = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "tests"))].filter(
      (f) => !f.endsWith("requirements.test.ts"),
    );
    const missing = new Set<string>();
    for (const file of files) {
      for (const [ref] of readFileSync(file, "utf8").matchAll(ID)) if (!ids.has(ref)) missing.add(`${ref} (${file.slice(root.length + 1)})`);
    }
    expect([...missing]).toEqual([]);
  });
});
