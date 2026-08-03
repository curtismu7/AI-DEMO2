// demo_api_ui/src/context/ThemeContext.js
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext(null);

export const THEME_STORAGE_KEY = 'ba_dark_mode';

function readStoredDarkMode() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Owns app-wide dark mode and writes it to `data-theme` on the document root.
 *
 * App-controlled on purpose, never seeded from `prefers-color-scheme`: only some
 * components carry dark styling, so following the OS turned dark-capable panels
 * dark on load with no way to turn them off.
 *
 * This used to live inside AIAgent. Dark-capable CSS is keyed to
 * `:root[data-theme="dark"]`, so on any page where AIAgent was not mounted
 * nothing set the attribute and those panels stayed light whatever the user had
 * chosen. Hoisting it here makes the choice hold app-wide.
 */
export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(readStoredDarkMode);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(darkMode));
    } catch {
      // Private mode / storage disabled — the attribute below still applies for
      // this session, the choice just does not survive a reload.
    }
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => setDarkMode((v) => !v), []);

  const value = useMemo(
    () => ({ darkMode, setDarkMode, toggleDarkMode }),
    [darkMode, toggleDarkMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const INERT_THEME = Object.freeze({
  darkMode: false,
  setDarkMode: () => {},
  toggleDarkMode: () => {},
});

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/**
 * Same shape, but safe outside a provider — follows the `useEducationUIOptional`
 * convention. Returns an inert light-mode value rather than null so callers can
 * destructure unconditionally, which keeps the 20 suites that render AIAgent
 * standalone working without each having to mock this context.
 */
export function useThemeOptional() {
  return useContext(ThemeContext) || INERT_THEME;
}
