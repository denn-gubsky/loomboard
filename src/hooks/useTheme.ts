import { useCallback, useLayoutEffect, useState } from "react";
import {
  applyTheme,
  resolveInitialTheme,
  saveTheme,
  type Theme,
} from "../state/theme";

// Owns the active theme for the session. Initializes from the DOM attribute the
// boot script set (no flash), applies changes to <html> before paint, and
// persists the user's explicit choice.
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    saveTheme(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
