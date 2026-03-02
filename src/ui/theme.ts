import { signal, effect } from "@preact/signals";

export type Theme = "light" | "dark" | "auto";

export const theme = signal<Theme>("auto");

function getEffectiveTheme(t: Theme): "light" | "dark" {
  if (t !== "auto") return t;
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

export const effectiveTheme = signal<"light" | "dark">(
  getEffectiveTheme("auto"),
);

if (typeof window !== "undefined") {
  effect(() => {
    effectiveTheme.value = getEffectiveTheme(theme.value);
    document.documentElement.setAttribute(
      "data-theme",
      effectiveTheme.value,
    );
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (theme.value === "auto") {
        effectiveTheme.value = getEffectiveTheme("auto");
      }
    });
}

export function toggleTheme(): void {
  const current = effectiveTheme.value;
  theme.value = current === "dark" ? "light" : "dark";
}
