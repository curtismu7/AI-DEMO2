// demo_api_ui/src/pages/FootprintPicksPage.jsx
// Locked costumes — pick one to focus / open live.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FootprintChrome } from "../components/aiFootprintMocks/ChromeFrames";
import { LOCKED_PICKS } from "../components/aiFootprintMocks/mockSelection";
import { FootprintThemeToggle } from "../components/aiFootprintMocks/FootprintThemeToggle";
import { useFootprintTheme } from "../hooks/useFootprintTheme";
import "./FootprintMockGalleryPage.css";

/**
 * Locked costumes with a picker to focus one and open it live.
 */
export default function FootprintPicksPage() {
  const navigate = useNavigate();
  const [theme, toggleTheme] = useFootprintTheme();
  const [activeId, setActiveId] = useState(LOCKED_PICKS[0].category);
  const active = useMemo(
    () => LOCKED_PICKS.find((p) => p.category === activeId) || LOCKED_PICKS[0],
    [activeId],
  );

  return (
    <div className="afm-gallery afm-gallery--picks" data-testid="footprint-picks-page" data-theme={theme}>
      <header className="afm-gallery-head">
        <div className="afm-gallery-headrow">
          <h1>Your 4 locked costumes</h1>
          <FootprintThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <p>
          Pick which shell to focus, then open it live (Privilege MCP client — sign-in required).
        </p>
        <div className="afm-gallery-note">
          <Link to="/demo/footprint-mocks">Change picks (full gallery)</Link>
        </div>

        <div className="afm-pick-tabs" role="tablist" aria-label="Locked costumes">
          {LOCKED_PICKS.map((p) => {
            const on = p.category === activeId;
            return (
              <button
                key={p.category}
                type="button"
                role="tab"
                aria-selected={on}
                className={`afm-pick-tab${on ? " is-on" : ""}`}
                onClick={() => setActiveId(p.category)}
              >
                {p.short}
              </button>
            );
          })}
        </div>
      </header>

      <section className="afm-pick-focus" aria-label={active.label}>
        <div className="afm-cat-head">
          <h2>{active.label}</h2>
          <div className="afm-pick-focus-actions">
            <button
              type="button"
              className="afm-live-btn"
              onClick={() => navigate(active.route)}
            >
              Open live
            </button>
            <Link to={active.route}>Preview live →</Link>
          </div>
        </div>
        <div className="afm-pick-stage">
          <FootprintChrome
            category={active.category}
            variant={active.variant}
            preview
          />
        </div>
      </section>

      <div className="afm-cats afm-cats--thumbs" aria-label="All four previews">
        {LOCKED_PICKS.map((p) => (
          <button
            key={p.category}
            type="button"
            className={`afm-thumb${p.category === activeId ? " is-on" : ""}`}
            onClick={() => setActiveId(p.category)}
          >
            <div className="afm-thumb-preview" aria-hidden="true">
              <FootprintChrome category={p.category} variant={p.variant} preview />
            </div>
            <span>{p.short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
