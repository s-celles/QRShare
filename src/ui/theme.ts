import { signal, effect } from "@preact/signals";

/** Theme preference: "auto" follows the system setting. */
export type Theme = "light" | "dark" | "auto";

const THEME_CYCLE: Theme[] = ["auto", "light", "dark"];

function loadTheme(): Theme {
  if (typeof localStorage === "undefined") return "auto";
  const stored = localStorage.getItem("qrshare-theme") as Theme | null;
  return stored === "light" || stored === "dark" ? stored : "auto";
}

/** Next preference for the header button: auto (system) → light → dark → auto. */
export function nextTheme(current: Theme): Theme {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
}

/** The theme actually shown for a preference and the system setting. */
export function resolveTheme(preference: Theme, systemPrefersDark: boolean): "light" | "dark" {
  return preference === "auto" ? (systemPrefersDark ? "dark" : "light") : preference;
}

const darkQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export const theme = signal<Theme>(loadTheme());

/** Tracks the system setting so "auto" follows it live. */
const systemPrefersDark = signal<boolean>(darkQuery?.matches ?? false);

export const effectiveTheme = signal<"light" | "dark">(
  resolveTheme(theme.peek(), systemPrefersDark.peek()),
);

if (typeof window !== "undefined") {
  effect(() => {
    effectiveTheme.value = resolveTheme(theme.value, systemPrefersDark.value);
    document.documentElement.setAttribute("data-theme", effectiveTheme.value);
    localStorage.setItem("qrshare-theme", theme.value);
  });

  darkQuery?.addEventListener("change", (event) => {
    systemPrefersDark.value = event.matches;
  });
}

export function toggleTheme(): void {
  theme.value = nextTheme(theme.value);
}
