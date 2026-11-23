import type { Theme } from "./types";

const KEY = "pausa-theme";

/** Read a stored value back as a Theme, ignoring anything else. */
function asTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Make the page light, dark or system. The stylesheet follows the computer's mode by default and forces
 * one when `data-theme` is "light" or "dark", so "system" simply removes the attribute. The choice is also
 * kept in localStorage, which both windows share, so the next start paints in the right colours at once
 * instead of flashing the wrong ones until the settings arrive.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage can be blocked; the saved setting still applies once it loads
  }
}

/** Paint the last chosen theme straight away, before React has loaded the settings. */
export function applyStoredTheme(): void {
  try {
    applyTheme(asTheme(localStorage.getItem(KEY)));
  } catch {
    // no storage: start on the system theme
  }
}

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
