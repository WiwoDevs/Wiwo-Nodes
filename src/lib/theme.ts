import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "wiwo-nodes-theme";
const THEME_COLORS: Record<ThemeMode, string> = { dark: "#0c0c10", light: "#f4f4f8" };

function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Storage can be blocked (private mode, previews); fall back to the default.
  }
  return "dark";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[mode]);
}

/** Applies the persisted theme before the first render to avoid a flash of the wrong palette. */
export function initTheme() {
  applyTheme(readStoredTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference simply won't persist when storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => (current === "dark" ? "light" : "dark")), []);

  return { theme, toggleTheme };
}
