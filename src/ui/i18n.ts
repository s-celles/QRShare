import { signal, effect } from "@preact/signals";
import { en } from "./translations/en";
import { fr } from "./translations/fr";

export type Locale = "en" | "fr";
export type LocalePreference = Locale | "auto";

const translations: Record<Locale, Record<string, string>> = { en, fr };

function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("fr") ? "fr" : "en";
}

function loadPreference(): LocalePreference {
  if (typeof localStorage === "undefined") return "auto";
  return (localStorage.getItem("qrshare-locale") as LocalePreference) || "auto";
}

export const localePreference = signal<LocalePreference>(loadPreference());

export const locale = signal<Locale>(
  localePreference.peek() === "auto"
    ? detectLocale()
    : (localePreference.peek() as Locale),
);

if (typeof window !== "undefined") {
  effect(() => {
    const pref = localePreference.value;
    locale.value = pref === "auto" ? detectLocale() : pref;
    localStorage.setItem("qrshare-locale", pref);
  });
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = translations[locale.value] || translations.en;
  let text = dict[key] ?? translations.en[key] ?? key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  }
  return text;
}
