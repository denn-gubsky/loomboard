// Light/dark theme, persisted in localStorage and reflected as data-theme on
// <html> (the CSS palette keys off it). The decision logic is pure so it's
// unit-tested in the node test env; the localStorage/matchMedia/DOM wrappers
// are thin and env-guarded.

export type Theme = "light" | "dark";

const KEY = "loomboard.theme";

/** Narrow a stored/attribute value to a Theme, or null if absent/garbage. Pure. */
export function parseTheme(raw: string | null | undefined): Theme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

/** Resolve the effective theme: an explicit saved choice wins; otherwise follow
 *  the OS preference. Pure — the caller supplies both inputs. */
export function pickTheme(saved: Theme | null, systemPrefersLight: boolean): Theme {
  if (saved) return saved;
  return systemPrefersLight ? "light" : "dark";
}

export function loadTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage unavailable (e.g. private mode) — the theme just won't persist.
  }
}

export function systemPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/** Theme to start with. The <head> boot script already set data-theme on <html>
 *  before paint; trust it so React state matches the painted DOM. Fall back to
 *  the saved/OS resolution if the attribute is missing. */
export function resolveInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = parseTheme(document.documentElement.dataset.theme);
    if (attr) return attr;
  }
  return pickTheme(loadTheme(), systemPrefersLight());
}

/** Reflect the theme onto <html> so the CSS variable overrides take effect. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}
