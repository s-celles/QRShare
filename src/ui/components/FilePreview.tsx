import { useEffect, useState } from "preact/hooks";
import { marked } from "marked";
import { ShareService } from "@/share/service";

interface FilePreviewProps {
  url: string;
  filename: string;
  mimeType?: string;
}

function kindOf(filename: string, mimeType = ""): "image" | "video" | "audio" | "pdf" | "text" | "vcard" | "none" {
  const lower = filename.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/.test(lower)) return "image";
  if (mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mov)$/.test(lower)) return "video";
  if (mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(lower)) return "audio";
  if (mimeType === "application/pdf" || /\.pdf$/.test(lower)) return "pdf";
  if (mimeType.toLowerCase().split(";")[0] === "text/vcard" || /\.(vcf|vcard)$/.test(lower)) return "vcard";
  if (mimeType.startsWith("text/") || /\.(css|csv|log|md|markdown|txt|xml|yaml|yml|json)$/.test(lower)) return "text";
  return "none";
}

type ContactField = { label: string; value: string };

function unescapeVCard(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([\\,;:])/g, "$1").trim();
}

function parseVCard(value: string): ContactField[] {
  const lines = value.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const labels: Record<string, string> = { FN: "Name", N: "Full name", ORG: "Organization", TITLE: "Title", TEL: "Phone", EMAIL: "Email", ADR: "Address", URL: "Website", NOTE: "Note" };
  const fields: ContactField[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("BEGIN:") || line.startsWith("END:") || line.startsWith("VERSION:")) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).split(";")[0].toUpperCase();
    const label = labels[name];
    if (!label) continue;
    let fieldValue = unescapeVCard(line.slice(separator + 1));
    if (name === "N" && fieldValue.includes(";")) fieldValue = fieldValue.split(";").filter(Boolean).join(" ");
    if (name === "ADR" && fieldValue.includes(";")) fieldValue = fieldValue.split(";").filter(Boolean).join(", ");
    if (fieldValue) fields.push({ label, value: fieldValue });
  }
  return fields;
}

function VCardPreview({ url, filename, text }: { url: string; filename: string; text: string }) {
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const fields = parseVCard(text);
  const share = async () => {
    setSharing(true); setMessage("");
    const result = await new ShareService().shareFile(new File([text], filename, { type: "text/vcard" }));
    setSharing(false);
    if (result.kind === "unsupported") setMessage("Le partage de fichiers n’est pas disponible dans ce navigateur.");
    else if (result.kind === "cancelled") setMessage("Partage annulé.");
  };
  return <div class="file-preview file-preview-vcard">
    <div class="vcard-heading"><span class="vcard-avatar" aria-hidden="true">👤</span><div><strong>{fields.find((field) => field.label === "Name")?.value || filename}</strong><small>Contact vCard</small></div></div>
    {fields.length > 0 && <dl>{fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
    <div class="vcard-actions">
      <a class="share-action" href={url} download={filename}>Ajouter aux contacts</a>
      <a class="share-action" href={url} download={filename}>Télécharger</a>
      <button class="share-action" onClick={share} disabled={sharing}>{sharing ? "Partage…" : "Partager"}</button>
    </div>
    {message && <p class="share-status" role="status">{message}</p>}
  </div>;
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
    if (kind === "text" || kind === "vcard") {
      fetch(url).then((response) => response.text()).then((value) => {
        if (!cancelled) setText(value);
      }).catch(() => {
        if (!cancelled) setText(null);
      });
    }
    return () => { cancelled = true; };
  }, [url, kind]);

  if (kind === "image") return <div class="file-preview file-preview-media"><img src={url} alt={filename} loading="lazy" /></div>;
  if (kind === "video") return <div class="file-preview file-preview-media"><video src={url} controls aria-label={filename} /></div>;
  if (kind === "audio") return <div class="file-preview file-preview-audio"><audio src={url} controls aria-label={filename} /></div>;
  if (kind === "pdf") return <div class="file-preview file-preview-pdf"><object data={url} type="application/pdf" aria-label={filename}><p>PDF Preview not available.</p></object></div>;
  if (kind === "vcard" && text != null) return <VCardPreview url={url} filename={filename} text={text} />;
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
