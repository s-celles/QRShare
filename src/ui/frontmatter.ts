/**
 * YAML frontmatter of received Markdown files, shown as a simple key/value table by
 * FilePreview. Nested entries are listed in order (list items keep their "- " prefix);
 * double-quoted values that are valid JSON strings (as in paste board exports,
 * REQ-PASTE-107) are shown unquoted. Values are only ever rendered as text.
 */
export type FrontmatterEntry = { key: string; value: string };

function displayValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "string") return value;
    } catch {
      // not a JSON string: shown as written
    }
  }
  return raw;
}

export function parseFrontmatter(markdown: string): { entries: FrontmatterEntry[]; body: string } {
  const match = markdown.match(/^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { entries: [], body: markdown };

  const entries: FrontmatterEntry[] = [];
  let current: FrontmatterEntry | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const key = line.match(/^\s*([^:#][^:]*):\s*(.*)$/);
    if (key) {
      current = { key: key[1].trim(), value: displayValue(key[2].trim()) };
      entries.push(current);
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && current) current.value = current.value ? `${current.value}, ${item[1].trim()}` : item[1].trim();
  }
  return { entries, body: markdown.slice(match[0].length) };
}
