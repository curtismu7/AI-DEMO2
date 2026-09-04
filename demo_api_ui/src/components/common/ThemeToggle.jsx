// Shared light/dark toggle button — drives the app-wide ThemeContext, so it
// stays in sync with every other dark-capable page. Two pages had already grown
// their own bespoke sun/moon toggle (SdkLoginPage, DavinciExplainerPage) with
// different icon styles and different local-only state; this is the one to
// reach for on any page wired to the real (non-sandboxed) theme.
import { useThemeOptional } from '../../context/ThemeContext';
import './ThemeToggle.css';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggleDarkMode}
      aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
      title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
    >
      {darkMode ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
