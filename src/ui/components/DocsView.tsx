import { useEffect, useMemo, useRef } from "preact/hooks";
import { currentRoute, hashParams, navigate } from "../router";
import { effectiveTheme } from "../theme";
import { markdownToHtml } from "../markdown";
import { locale, t } from "../i18n";
import { DOC_PAGES, docLanguage, docRoute, findDocByFile, findDocPage, type DocGroup, type DocPage } from "../docs";
import { DOCS_URL } from "../links";

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  run: (opts: { nodes: NodeListOf<Element>; suppressErrors: boolean }) => Promise<void>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Mermaid is large and only needed for diagrams: load it from the CDN on first use. */
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.onload = () => resolve((globalThis as unknown as { mermaid: MermaidApi }).mermaid);
    script.onerror = () => {
      mermaidPromise = null;
      reject(new Error("Failed to load Mermaid"));
    };
    document.head.appendChild(script);
  });
  return mermaidPromise;
}

async function renderMermaid(container: HTMLElement, theme: string): Promise<void> {
  const nodes = container.querySelectorAll(".mermaid");
  if (nodes.length === 0) return;
  try {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default" });
    // Keep the source so diagrams can be drawn again on a theme or language change.
    nodes.forEach((node) => {
      const source = node.getAttribute("data-mermaid-src");
      if (source) {
        node.textContent = source;
        node.removeAttribute("data-processed");
      } else {
        node.setAttribute("data-mermaid-src", node.textContent || "");
      }
    });
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // Offline or blocked: diagrams stay as text.
  }
}

/** Links to a docs/ file or to a section of the current page stay in the app; anything else is external. */
function docLinkResolver(current: DocPage): (href: string) => string | null {
  return (href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    const [file, section] = href.split("#", 2);
    const page = file ? findDocByFile(file) : current;
    return page ? docRoute(page.slug, section) : null;
  };
}

const GROUPS: DocGroup[] = ["using", "developing"];

function DocsNav({ current }: { current?: DocPage }) {
  return (
    <nav class="docs-nav" aria-label={t("docs.navLabel")}>
      {GROUPS.map((group) => (
        <div key={group} class="docs-nav-group">
          <p class="docs-nav-title">{t(`docs.group.${group}`)}</p>
          <ul>
            {DOC_PAGES.filter((page) => page.group === group).map((page) => (
              <li key={page.slug}>
                <a
                  href={docRoute(page.slug)}
                  aria-current={page === current ? "page" : undefined}
                >
                  {t(`docs.page.${page.slug}`)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DocsIndex() {
  return (
    <div class="docs-index">
      <p class="docs-intro">{t("docs.intro")}</p>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`docs-${group}`}>
          <h3 id={`docs-${group}`}>{t(`docs.group.${group}`)}</h3>
          <div class="docs-cards">
            {DOC_PAGES.filter((page) => page.group === group).map((page) => (
              <a key={page.slug} class="docs-card" href={docRoute(page.slug)}>
                <span class="docs-card-title">{t(`docs.page.${page.slug}`)}</span>
                <span class="docs-card-desc">{t(`docs.desc.${page.slug}`)}</span>
                {docLanguage(page, locale.value) !== locale.value && (
                  <span class="docs-lang">{t("docs.inEnglish")}</span>
                )}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The documentation: an index of the docs/ pages, and each page rendered in-app. */
export function DocsView() {
  const containerRef = useRef<HTMLDivElement>(null);
  // #/guide is the user guide; #/docs?page=<slug> any page; #/docs alone the index.
  const params = hashParams.value;
  const page = currentRoute.value === "/guide" ? findDocPage("user-guide") : findDocPage(params.get("page"));
  // &lang=fr shows a translation whatever the interface language (links from the README).
  const lang = page ? docLanguage(page, params.get("lang") ?? locale.value) : "en";
  const section = params.get("section");
  const html = useMemo(
    () => (page ? markdownToHtml(page.content[lang] ?? page.content.en, docLinkResolver(page)) : ""),
    [page, lang],
  );
  const theme = effectiveTheme.value;

  useEffect(() => {
    const target = section ? document.getElementById(section) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [page, lang, section]);

  useEffect(() => {
    if (containerRef.current) void renderMermaid(containerRef.current, theme);
  }, [html, theme]);

  return (
    <section class="docs" aria-label={t("docs.section")}>
      <div class="view-header">
        <button onClick={() => navigate(page ? "/docs" : "/")} aria-label={page ? t("docs.backToIndex") : t("common.backToHome")}>
          &larr; {page ? t("docs.heading") : t("common.back")}
        </button>
        {/* A page brings its own title (the h1 of the Markdown file). */}
        {!page && <h2>{t("docs.heading")}</h2>}
      </div>

      {page ? (
        <div class="docs-layout">
          <DocsNav current={page} />
          <article class="docs-article">
            {locale.value !== "en" && !(locale.value in page.content) && (
              <p class="docs-lang-note">{t("docs.englishOnly")}</p>
            )}
            <div ref={containerRef} class="guide-content" dangerouslySetInnerHTML={{ __html: html }} />
            <p class="docs-source">
              <a href={`${DOCS_URL}/${page.files[lang] ?? page.files.en}`} target="_blank" rel="noopener noreferrer">
                {t("docs.onGitHub")}
              </a>
            </p>
          </article>
        </div>
      ) : (
        <DocsIndex />
      )}
    </section>
  );
}
