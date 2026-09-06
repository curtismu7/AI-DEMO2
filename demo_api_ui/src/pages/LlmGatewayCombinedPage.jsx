// demo_api_ui/src/pages/LlmGatewayCombinedPage.jsx
//
// Wraps the two Privilege LLM gateway pages under one page with a tab strip,
// so /llm-gateway and /llm-test are one destination instead of two nav entries
// to the same subject.
//
// Deliberately a thin switcher, not a merge of the two components' internals.
// LlmGatewayPage (the chat console, which classifies a call's outcome) and
// LlmTestPage (the raw REST client, which interprets nothing — see its own
// header comment for why that separation matters) each already fetch their
// own /llm/config and manage their own state, and each has a test suite
// pinning that behaviour. Lifting the shared state into this wrapper would
// touch both, for no benefit a demo audience would notice, and would be a much
// larger diff to get wrong. Only one tab is mounted at a time, so there is no
// double-polling and no duplicate DOM ids while a tab is inactive.
import { useEffect, useMemo, useState } from 'react';
import LlmGatewayPage from './LlmGatewayPage';
import LlmTestPage from './LlmTestPage';
import './LlmGatewayCombinedPage.css';

const TABS = [
  { key: 'chat', label: 'Chat console' },
  { key: 'raw', label: 'Raw request' },
];

// Every font-size in this page family (LlmGatewayCombinedPage.css,
// LlmGatewayPage.css, LlmTestPage.css) uses one of exactly these three
// tokens — verified by grep before writing this. Overriding them as CSS
// custom properties on THIS wrapper, not a `transform: scale()` on the
// whole tree, means the resize affects text size only: no blurry raster
// scaling, no layout/hit-target distortion, and it still cascades to
// whichever tab is mounted since custom properties inherit through the DOM
// regardless of component boundaries.
const SCALED_TOKENS = ['--font-size-sm', '--font-size-base', '--font-size-2xl'];
const STORAGE_KEY = 'ai_guard_font_scale';
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.6;
const STEP = 0.15;

function loadScale() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_SCALE && saved <= MAX_SCALE ? saved : 1;
  } catch {
    return 1; // localStorage can throw in a locked-down browser context
  }
}

export default function LlmGatewayCombinedPage({ defaultTab = 'chat' }) {
  const [tab, setTab] = useState(defaultTab);
  const [scale, setScale] = useState(loadScale);

  // Base px values read once from the real stylesheet rather than hardcoded,
  // so this keeps working if THEMING.md's scale ever changes those numbers.
  const [basePx] = useState(() => {
    if (typeof window === 'undefined') return {};
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const token of SCALED_TOKENS) {
      out[token] = parseFloat(cs.getPropertyValue(token)) || 14;
    }
    return out;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(scale)); } catch { /* per-viewer convenience only */ }
  }, [scale]);

  const scaledVars = useMemo(() => {
    const vars = {};
    for (const token of SCALED_TOKENS) {
      vars[token] = `${((basePx[token] || 14) * scale).toFixed(1)}px`;
    }
    return vars;
  }, [basePx, scale]);

  return (
    <div className="lgwc" style={scaledVars}>
      <div className="lgwc-tabs">
        <nav className="lgwc-tablist" role="tablist" aria-label="LLM Gateway view">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`lgwc-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="lgwc-fontctl" role="group" aria-label="Text size">
          <button
            type="button"
            className="lgwc-fontbtn"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - STEP).toFixed(2)))}
            disabled={scale <= MIN_SCALE}
            title="Smaller text"
            aria-label="Decrease text size"
          >
            A−
          </button>
          <span className="lgwc-fontpct">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="lgwc-fontbtn"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + STEP).toFixed(2)))}
            disabled={scale >= MAX_SCALE}
            title="Bigger text"
            aria-label="Increase text size"
          >
            A+
          </button>
        </div>
      </div>
      {tab === 'chat' ? <LlmGatewayPage /> : <LlmTestPage />}
    </div>
  );
}
