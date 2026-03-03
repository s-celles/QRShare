import { signal, computed } from "@preact/signals";
import { navigate } from "../router";
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

export function GuideView() {
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
        class="guide-content"
        dangerouslySetInnerHTML={{ __html: htmlContent.value }}
      />
    </section>
  );
}
