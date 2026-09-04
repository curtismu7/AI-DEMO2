// PreviewBanner.jsx — shown at the top of every Agent Studio (Preview) page.
// Keeps the "this is simulated" framing and Platform Gaps link impossible to
// miss while clicking through screens that otherwise look fully functional.
// Also the one shared place all 4 pages render, so the dark/light toggle
// lives here instead of being duplicated per page — the CSS (agentStudioPreview.css)
// already has a full :root[data-theme="dark"] .asp-root override (and a
// second one for the Discovery variant), it just had no control reaching it.
import React from "react";
import { Link } from "react-router-dom";
import { useThemeOptional } from "../../context/ThemeContext";

export default function PreviewBanner() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <div className="asp-banner-row">
      <div className="asp-banner">
        Simulated preview — no real backend calls.{" "}
        <Link to="/platform-gaps">See Platform Gaps →</Link>
      </div>
      <button
        type="button"
        className="asp-theme-toggle"
        onClick={toggleDarkMode}
        title="Switch this page between light and dark"
        aria-pressed={darkMode}
      >
        {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
      </button>
    </div>
  );
}
