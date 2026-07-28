// Shared Light/Dark control for the AI-footprint costume-picker pages
// (gallery, locked picks, live shell). See ../../hooks/useFootprintTheme.js.
export function FootprintThemeToggle({ theme, onToggle }) {
  return (
    <div className="afm-theme-toggle">
      <button
        type="button"
        className={`afm-theme-btn${theme === "light" ? " is-on" : ""}`}
        aria-pressed={theme === "light"}
        onClick={() => theme !== "light" && onToggle()}
      >
        Light
      </button>
      <button
        type="button"
        className={`afm-theme-btn${theme === "dark" ? " is-on" : ""}`}
        aria-pressed={theme === "dark"}
        onClick={() => theme !== "dark" && onToggle()}
      >
        Dark
      </button>
    </div>
  );
}
