// context/ThemeContext.jsx — app-wide dark mode, written to `data-theme` on
// the document root. Adapted from the banking demo's version (same shape),
// just its own localStorage key.
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext(null);

export const THEME_STORAGE_KEY = 'ai_gateway_client_dark_mode';

function readStoredDarkMode() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(readStoredDarkMode);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(darkMode));
    } catch {
      // Private mode / storage disabled — the attribute below still applies
      // for this session, the choice just doesn't survive a reload.
    }
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => setDarkMode((v) => !v), []);

  const value = useMemo(() => ({ darkMode, setDarkMode, toggleDarkMode }), [darkMode, toggleDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const INERT_THEME = Object.freeze({ darkMode: false, setDarkMode: () => {}, toggleDarkMode: () => {} });

export function useThemeOptional() {
  return useContext(ThemeContext) || INERT_THEME;
}
