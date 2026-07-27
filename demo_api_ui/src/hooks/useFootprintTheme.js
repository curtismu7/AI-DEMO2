// Manual light/dark toggle for the AI-footprint costume-picker pages
// (gallery, locked picks, live shell). Scoped via a `data-theme` attribute
// on each page's own root — does not touch the rest of the app's theme.
import { useCallback, useState } from "react";

const STORAGE_KEY = "ai-footprint-theme-v1";

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function readTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* ignore */
  }
  return systemPrefersDark() ? "dark" : "light";
}

export function useFootprintTheme() {
  const [theme, setTheme] = useState(readTheme);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
