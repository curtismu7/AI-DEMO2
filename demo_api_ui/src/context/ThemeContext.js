// demo_api_ui/src/context/ThemeContext.js
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext(null);

export const THEME_STORAGE_KEY = 'ba_dark_mode';
export const FONT_SCALE_STORAGE_KEY = 'ba_font_scale';

// The dial TopNav cycles through. The shipped default is 1.125 (matches the
// inline index.html zoom — the app's baseline type is one notch above stock).
// Each step ≈ one browser "larger" notch: presenters step up on a projector,
// step back down after.
export const FONT_SCALES = [1, 1.125, 1.25, 1.375];
export const FONT_SCALE_DEFAULT = 1.125;

function readStoredDarkMode() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readStoredFontScale() {
  try {
    const value = Number(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
    return FONT_SCALES.includes(value) ? value : FONT_SCALE_DEFAULT;
  } catch {
    return 1;
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
 *
 * Also owns the page font scale (demo projector dial). Applied as `zoom` on
 * `html` from here rather than in CSS: lightningcss (vite 8's css minifier)
 * strips `zoom` from built stylesheets, but a runtime inline style survives.
 * index.html seeds the pre-React paint so the page never flashes small-then-big.
 */
export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(readStoredDarkMode);
  const [fontScale, setFontScale] = useState(readStoredFontScale);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(darkMode));
    } catch {
      // Private mode / storage disabled — the attribute below still applies for
      // this session, the choice just does not survive a reload.
    }
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.style.zoom = String(fontScale);
    try {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch {
      // Storage disabled — the inline style above still applies this session.
    }
  }, [fontScale]);

  const toggleDarkMode = useCallback(() => setDarkMode((v) => !v), []);

  const cycleFontScale = useCallback(
    () => setFontScale((v) => FONT_SCALES[(FONT_SCALES.indexOf(v) + 1) % FONT_SCALES.length]),
    [],
  );

  const value = useMemo(
    () => ({ darkMode, setDarkMode, toggleDarkMode, fontScale, setFontScale, cycleFontScale }),
    [darkMode, toggleDarkMode, fontScale, cycleFontScale],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const INERT_THEME = Object.freeze({
  darkMode: false,
  setDarkMode: () => {},
  toggleDarkMode: () => {},
  fontScale: 1.125,
  setFontScale: () => {},
  cycleFontScale: () => {},
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
