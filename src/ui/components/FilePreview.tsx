import { useEffect, useState } from "preact/hooks";
import { marked } from "marked";

interface FilePreviewProps {
  url: string;
  filename: string;
  mimeType?: string;
}

function kindOf(filename: string, mimeType = ""): "image" | "text" | "none" {
  const lower = filename.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/.test(lower)) return "image";
  if (mimeType.startsWith("text/") || /\.(css|csv|log|md|markdown|txt|xml|yaml|yml|json)$/.test(lower)) return "text";
  return "none";
}

function renderMarkdown(markdown: string): string {
  const renderer = new marked.Renderer();
  renderer.html = () => "";
  return marked.parse(markdown, { gfm: true, breaks: true, renderer }) as string;
}

type FrontmatterEntry = { key: string; value: string };

function parseFrontmatter(markdown: string): { entries: FrontmatterEntry[]; body: string } {
  const match = markdown.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { entries: [], body: markdown };

  const entries: FrontmatterEntry[] = [];
  let current: FrontmatterEntry | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const key = line.match(/^\s*([^:#][^:]*):\s*(.*)$/);
    if (key) {
      current = { key: key[1].trim(), value: key[2].trim() };
      entries.push(current);
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && current) current.value = current.value ? `${current.value}, ${item[1].trim()}` : item[1].trim();
  }
  return { entries, body: markdown.slice(match[0].length) };
}

function FrontmatterView({ entries }: { entries: FrontmatterEntry[] }) {
  if (!entries.length) return null;
  return (
    <section class="file-frontmatter" aria-label="Document metadata">
      <div class="file-frontmatter-heading"><span aria-hidden="true">✦</span> Metadata</div>
      <table>
        <tbody>{entries.map(({ key, value }) => (
          <tr key={key}><th scope="row">{key}</th><td>{value || <span class="file-frontmatter-empty">—</span>}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export function FilePreview({ url, filename, mimeType }: FilePreviewProps) {
  const kind = kindOf(filename, mimeType);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (kind === "text") {
      fetch(url).then((response) => response.text()).then((value) => {
        if (!cancelled) setText(value);
      }).catch(() => {
        if (!cancelled) setText(null);
      });
    }
    return () => { cancelled = true; };
  }, [url, kind]);

  if (kind === "image") return <div class="file-preview"><img src={url} alt={filename} loading="lazy" /></div>;
  if (kind === "text" && text != null) {
    const markdown = /\.(md|markdown)$/i.test(filename);
    if (markdown) {
      const { entries, body } = parseFrontmatter(text);
      return <div class="file-preview file-preview-markdown">
        <FrontmatterView entries={entries} />
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      </div>;
    }
    return <div class="file-preview file-preview-text"><pre>{text}</pre></div>;
  }
  return null;
}
