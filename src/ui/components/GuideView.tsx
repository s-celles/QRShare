import { signal, computed } from "@preact/signals";
import { useRef, useEffect } from "preact/hooks";
import { navigate } from "../router";
import { effectiveTheme } from "../theme";
import { markdownToHtml } from "../markdown";
import guideEn from "../../../docs/en-user-guide.md" with { type: "text" };
import guideFr from "../../../docs/fr-guide-utilisateur.md" with { type: "text" };

type Lang = "en" | "fr";

function detectLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("fr") ? "fr" : "en";
}

const lang = signal<Lang>(detectLang());

const htmlContent = computed(() =>
  markdownToHtml(lang.value === "fr" ? guideFr : guideEn),
);

let mermaidLoaded = false;
let mermaidLoading = false;

async function loadMermaid(): Promise<typeof globalThis & { mermaid?: { initialize: (cfg: Record<string, unknown>) => void; run: (opts: { nodes: NodeListOf<Element> }) => Promise<void> } }> {
  if (mermaidLoaded) return globalThis as ReturnType<typeof loadMermaid> extends Promise<infer T> ? T : never;
  if (mermaidLoading) {
    // Wait for existing load
    await new Promise<void>((resolve) => {
      const check = () => {
        if (mermaidLoaded) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    return globalThis as ReturnType<typeof loadMermaid> extends Promise<infer T> ? T : never;
  }
  mermaidLoading = true;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.onload = () => {
      mermaidLoaded = true;
      mermaidLoading = false;
      resolve(globalThis as ReturnType<typeof loadMermaid> extends Promise<infer T> ? T : never);
    };
    script.onerror = () => {
      mermaidLoading = false;
      reject(new Error("Failed to load Mermaid"));
    };
    document.head.appendChild(script);
  });
}

async function renderMermaid(container: HTMLElement, theme: string): Promise<void> {
  const nodes = container.querySelectorAll(".mermaid");
  if (nodes.length === 0) return;

  try {
    await loadMermaid();
    const m = (globalThis as unknown as { mermaid: { initialize: (cfg: Record<string, unknown>) => void; run: (opts: { nodes: NodeListOf<Element>; suppressErrors: boolean }) => Promise<void> } }).mermaid;
    m.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
    });
    // Reset processed state so re-render works on theme/language change
    nodes.forEach((node) => {
      if (node.getAttribute("data-mermaid-src")) {
        node.textContent = node.getAttribute("data-mermaid-src");
        node.removeAttribute("data-processed");
      } else {
        // First render: store original source
        node.setAttribute("data-mermaid-src", node.textContent || "");
      }
    });
    await m.run({ nodes, suppressErrors: true });
  } catch {
    // Mermaid failed to load — diagrams stay as text
  }
}

export function GuideView() {
  const containerRef = useRef<HTMLDivElement>(null);

  const currentTheme = effectiveTheme.value;
  const currentHtml = htmlContent.value;

  useEffect(() => {
    if (containerRef.current) {
      renderMermaid(containerRef.current, currentTheme);
    }
  }, [currentHtml, currentTheme]);

  return (
    <section aria-label="User Guide">
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label="Back to home">
          &larr; Back
        </button>
        <h2>{lang.value === "fr" ? "Guide utilisateur" : "User Guide"}</h2>
        <div class="lang-toggle">
          <button
            class={`lang-btn ${lang.value === "en" ? "active" : ""}`}
            onClick={() => {
              lang.value = "en";
            }}
            aria-label="English"
          >
            EN
          </button>
          <button
            class={`lang-btn ${lang.value === "fr" ? "active" : ""}`}
            onClick={() => {
              lang.value = "fr";
            }}
            aria-label="Français"
          >
            FR
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        class="guide-content"
        dangerouslySetInnerHTML={{ __html: currentHtml }}
      />
    </section>
  );
}
