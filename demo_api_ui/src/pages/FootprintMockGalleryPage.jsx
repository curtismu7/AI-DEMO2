// demo_api_ui/src/pages/FootprintMockGalleryPage.jsx
// SE picker: compare costume-shell chrome variants and lock a choice per category.
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { FootprintChrome } from "../components/aiFootprintMocks/ChromeFrames";
import {
  MOCK_CATALOG,
  readMockSelection,
  writeMockSelection,
} from "../components/aiFootprintMocks/mockSelection";
import "./FootprintMockGalleryPage.css";

const CATEGORIES = /** @type {const} */ (["vscode", "chatgpt", "saas", "coding"]);

/**
 * Gallery of mock UI chrome options for Personal/Workload footprint demos.
 */
export default function FootprintMockGalleryPage() {
  const [selection, setSelection] = useState(() => readMockSelection());

  const handleSelect = useCallback((category, variantId) => {
    setSelection(writeMockSelection(category, variantId));
  }, []);

  return (
    <div className="afm-gallery" data-testid="footprint-mock-gallery">
      <header className="afm-gallery-head">
        <h1>AI footprint mock picker</h1>
        <p>
          Choose a visual costume for each demo shell. Live routes host the real Ping
          banking agent inside the selected chrome. Dashboard covers Self-Managed and
          Agentic Customers without a costume.
        </p>
        <div className="afm-gallery-note">
          Picks persist in this browser (localStorage). Open a live route to rehearse
          with HITL / MFA / Token Chain.
        </div>
      </header>

      {CATEGORIES.map((category) => {
        const cat = MOCK_CATALOG[category];
        const selectedId = selection[category];
        return (
          <section className="afm-cat" key={category} aria-labelledby={`afm-${category}`}>
            <div className="afm-cat-head">
              <h2 id={`afm-${category}`}>{cat.label}</h2>
              <Link to={cat.route}>Open live →</Link>
            </div>
            <div className="afm-grid">
              {cat.variants.map((v) => {
                const isSelected = selectedId === v.id;
                return (
                  <article
                    key={v.id}
                    className={`afm-card${isSelected ? " is-selected" : ""}`}
                    data-testid={`afm-card-${category}-${v.id}`}
                  >
                    <div className="afm-card-preview" aria-hidden="true">
                      <FootprintChrome category={category} variant={v.id} preview />
                    </div>
                    <div className="afm-card-meta">
                      <h3>{v.name}</h3>
                      <p>{v.blurb}</p>
                      <div className="afm-card-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={isSelected}
                          onClick={() => handleSelect(category, v.id)}
                        >
                          {isSelected ? "Selected" : "Use this"}
                        </button>
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
        );
      })}
    </div>
  );
}
