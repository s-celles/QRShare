import { signal, effect } from "@preact/signals";
import { en } from "./translations/en";
import { fr } from "./translations/fr";
import { ar } from "./translations/ar";

export type Locale = "en" | "fr" | "ar";
export type LocalePreference = Locale | "auto";

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ar"]);

const translations: Record<Locale, Record<string, string>> = { en, fr, ar };

function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ar")) return "ar";
  if (lang.startsWith("fr")) return "fr";
  return "en";
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
    document.documentElement.lang = locale.value;
    document.documentElement.dir = RTL_LOCALES.has(locale.value) ? "rtl" : "ltr";
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
