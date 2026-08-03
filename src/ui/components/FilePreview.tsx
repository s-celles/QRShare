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
    return markdown
      ? <div class="file-preview file-preview-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      : <div class="file-preview file-preview-text"><pre>{text}</pre></div>;
  }
  return null;
}
