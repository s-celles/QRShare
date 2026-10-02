/**
 * The documentation pages of docs/, bundled into the app and shown under #/docs.
 * To add a page: create the Markdown file in docs/, import it here and list it
 * in DOC_PAGES (with "docs.page.<slug>" / "docs.desc.<slug>" translations).
 */
import userGuideEn from "../../docs/en-user-guide.md" with { type: "text" };
import userGuideFr from "../../docs/fr-guide-utilisateur.md" with { type: "text" };
import howItWorksEn from "../../docs/en-how-it-works.md" with { type: "text" };
import connectivityEn from "../../docs/en-connectivity-and-turn.md" with { type: "text" };
import collaborationEn from "../../docs/en-collaborative-editing.md" with { type: "text" };
import architectureEn from "../../docs/en-architecture.md" with { type: "text" };
import developmentEn from "../../docs/en-development.md" with { type: "text" };
import offlineSyncEn from "../../docs/en-offline-sync-protocol.md" with { type: "text" };

export type DocGroup = "using" | "developing";

export interface DocPage {
  slug: string;
  group: DocGroup;
  /** Markdown file name in docs/ and content, per language; "en" is always present. */
  files: { en: string; fr?: string };
  content: { en: string; fr?: string };
}

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: "user-guide",
    group: "using",
    files: { en: "en-user-guide.md", fr: "fr-guide-utilisateur.md" },
    content: { en: userGuideEn, fr: userGuideFr },
  },
  {
    slug: "how-it-works",
    group: "using",
    files: { en: "en-how-it-works.md" },
    content: { en: howItWorksEn },
  },
  {
    slug: "connectivity",
    group: "using",
    files: { en: "en-connectivity-and-turn.md" },
    content: { en: connectivityEn },
  },
  {
    slug: "collaboration",
    group: "using",
    files: { en: "en-collaborative-editing.md" },
    content: { en: collaborationEn },
  },
  {
    slug: "architecture",
    group: "developing",
    files: { en: "en-architecture.md" },
    content: { en: architectureEn },
  },
  {
    slug: "development",
    group: "developing",
    files: { en: "en-development.md" },
    content: { en: developmentEn },
  },
  {
    slug: "offline-sync",
    group: "developing",
    files: { en: "en-offline-sync-protocol.md" },
    content: { en: offlineSyncEn },
  },
];

export function findDocPage(slug: string | null | undefined): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

/** The page a docs/ file name (in any language) belongs to, e.g. "fr-guide-utilisateur.md". */
export function findDocByFile(file: string): DocPage | undefined {
  const name = file.split("/").pop() ?? file;
  return DOC_PAGES.find((page) => page.files.en === name || page.files.fr === name);
}

/** The language a page is shown in for the interface language: its own if available, else English. */
export function docLanguage(page: DocPage, locale: string): "en" | "fr" {
  return locale === "fr" && page.content.fr ? "fr" : "en";
}

/** The in-app address of a page. */
export const docRoute = (slug: string): string => `#/docs?page=${slug}`;
