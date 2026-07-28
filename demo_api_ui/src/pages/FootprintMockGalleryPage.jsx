// demo_api_ui/src/pages/FootprintMockGalleryPage.jsx
// SE picker: compare costume-shell chrome variants and lock a choice per category.
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FootprintChrome } from "../components/aiFootprintMocks/ChromeFrames";
import {
  MOCK_CATALOG,
  readMockSelection,
  writeMockSelection,
} from "../components/aiFootprintMocks/mockSelection";
import { useFootprintTheme } from "../hooks/useFootprintTheme";
import { FootprintThemeToggle } from "../components/aiFootprintMocks/FootprintThemeToggle";
import "./FootprintMockGalleryPage.css";

const CATEGORIES = /** @type {const} */ (["coding", "vscode", "chatgpt", "saas"]);

/**
 * Gallery of mock UI chrome options for Personal/Workload footprint demos.
 * ?view=picks — only the four locked/selected costumes (for tweak review).
 */
export default function FootprintMockGalleryPage() {
  const [theme, toggleTheme] = useFootprintTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const picksOnly = searchParams.get("view") === "picks";
  const [selection, setSelection] = useState(() => {
    const base = readMockSelection();
    // Optional URL overrides: ?coding=claude-code&vscode=light&...
    for (const key of CATEGORIES) {
      const q = searchParams.get(key);
      if (q && MOCK_CATALOG[key]?.variants?.some((v) => v.id === q)) {
        base[key] = q;
        writeMockSelection(key, q);
      }
    }
    return { ...readMockSelection(), ...base };
  });

  const handleSelect = useCallback((category, variantId) => {
    setSelection(writeMockSelection(category, variantId));
  }, []);

  const sections = useMemo(() => {
    return CATEGORIES.map((category) => {
      const cat = MOCK_CATALOG[category];
      const selectedId = selection[category];
      const variants = picksOnly
        ? cat.variants.filter((v) => v.id === selectedId)
        : cat.variants;
      return { category, cat, selectedId, variants };
    });
  }, [selection, picksOnly]);

  return (
    <div
      className={`afm-gallery${picksOnly ? " afm-gallery--picks" : ""}`}
      data-testid="footprint-mock-gallery"
      data-view={picksOnly ? "picks" : "all"}
      data-theme={theme}
    >
      <header className="afm-gallery-head">
        <div className="afm-gallery-headrow">
          <h1>{picksOnly ? "Your selected costumes" : "AI footprint mock picker"}</h1>
          <FootprintThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <p>
          {picksOnly
            ? "Only the four picks you locked. Open live to rehearse, or switch to all variants to change a pick."
            : "Choose a visual costume for each demo shell. Live routes host the real Ping banking agent inside the selected chrome."}
        </p>
        <div className="afm-gallery-note">
          {picksOnly ? (
            <>
              <Link to="/demo/footprint-mocks">Show all variants</Link>
              {" · "}
              Live agent host needs sign-in.
            </>
          ) : (
            <>
              <Link to="/demo/footprint-mocks?view=picks">Show only my picks</Link>
              {" · "}
              Jump to <a href="#coding">Claude Code / coding</a>.
            </>
          )}
        </div>
        <div className="afm-picks-bar" data-testid="afm-picks-bar">
          <code>
            coding: {selection.coding} · vscode: {selection.vscode} · chatgpt:{" "}
            {selection.chatgpt} · saas: {selection.saas}
          </code>
          <button
            type="button"
            className="afm-copy-picks"
            onClick={() => {
              const line = `coding: ${selection.coding}\nvscode: ${selection.vscode}\nchatgpt: ${selection.chatgpt}\nsaas: ${selection.saas}`;
              navigator.clipboard?.writeText(line).catch(() => {});
            }}
          >
            Copy picks
          </button>
          {!picksOnly ? (
            <button
              type="button"
              className="afm-copy-picks"
              onClick={() => setSearchParams({ view: "picks" })}
            >
              Picks only
            </button>
          ) : null}
        </div>
      </header>

      <div className={picksOnly ? "afm-cats" : undefined}>
        {sections.map(({ category, cat, selectedId, variants }) => (
          <section
            className="afm-cat"
            key={category}
            id={category}
            aria-labelledby={`afm-${category}`}
          >
            <div className="afm-cat-head">
              <h2 id={`afm-${category}`}>{cat.label}</h2>
              <Link to={cat.route}>Open live →</Link>
            </div>
            <div className={`afm-grid${picksOnly ? " afm-grid--picks" : ""}`}>
              {variants.map((v) => {
                const isSelected = selectedId === v.id;
                return (
                  <article
                    key={v.id}
                    className={`afm-card${isSelected ? " is-selected" : ""}${picksOnly ? " afm-card--large" : ""}`}
                    data-testid={`afm-card-${category}-${v.id}`}
                  >
                    <div className="afm-card-preview" aria-hidden="true">
                      <FootprintChrome category={category} variant={v.id} preview />
                    </div>
                    <div className="afm-card-meta">
                      <h3>{v.name}</h3>
                      <p>{v.blurb}</p>
                      <div className="afm-card-actions">
                        {!picksOnly ? (
                          <button
                            type="button"
                            className="primary"
                            disabled={isSelected}
                            onClick={() => handleSelect(category, v.id)}
                          >
                            {isSelected ? "Selected" : "Use this"}
                          </button>
                        ) : (
                          <Link className="afm-live-btn" to={cat.route}>
                            Open live
                          </Link>
                        )}
                        <Link to={cat.route}>Preview live</Link>
                        {isSelected ? (
                          <span className="afm-selected-pill">Active</span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
