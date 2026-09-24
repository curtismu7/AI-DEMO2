/**
 * useDiagramTheme — light/dark theme for the architecture POC pages.
 * Persists the choice and applies it by toggling the `rfp-dark` class on
 * the page root, so all theming is pure CSS variables.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "rfp-poc-theme";

export function useDiagramTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "dark") return true;
      if (saved === "light") return false;
    } catch {
      // ignore
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, dark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);

  return { dark, toggle };
}

export default useDiagramTheme;
