// banking_api_ui/src/components/EmbeddedAgentDock.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FootprintChrome } from './aiFootprintMocks/ChromeFrames';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import { useFootprintAutoDetect } from '../hooks/useFootprintAutoDetect';
import { useVertical } from '../vertical/useVertical';
import { resolveEmbeddedFocus } from './demoAgentSafety';
import { isEmbeddedAgentDockRoute } from '../utils/embeddedAgentFabVisibility';
import TokenExchangeModal from './TokenExchangeModal';

const HEIGHT_KEY = 'embedded_agent_dock_height_px';
const COLLAPSE_KEY = 'embedded_agent_dock_collapsed';
const DEFAULT_HEIGHT = 520;
const MIN_HEIGHT = 200;
const MAX_HEIGHT_RATIO = 0.85;

function readStoredHeight() {
  try {
    const n = parseInt(localStorage.getItem(HEIGHT_KEY) || '', 10);
    if (Number.isFinite(n) && n >= MIN_HEIGHT) return Math.min(n, Math.round(window.innerHeight * MAX_HEIGHT_RATIO));
  } catch {
    /* ignore */
  }
  return DEFAULT_HEIGHT;
}

function readStoredCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Bottom embedded AI agent: content-width strip, collapsible, vertically resizable.
 */
const FRAMEWORK_LABELS = {
  langchain:     'LangChain',
  openai_agents: 'OpenAI Agents',
  mastra:        'Mastra',
  pydantic_ai:   'Pydantic AI',
};

export default function EmbeddedAgentDock({ user, agentPlacement }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { setSurfaceHostEl } = useAgentUiMode();
  const { pageManifest } = useVertical();
  const terminology = pageManifest?.terminology;
  const identity = pageManifest?.identity;
  const [hostEl, setHostEl] = useState(null);
  const [frameworkLabel, setFrameworkLabel] = useState(null);
  const { category: fpCategory, variant: fpVariant } = useFootprintAutoDetect();
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const { category: fpCategory, variant: fpVariant } = useFootprintAutoDetect();
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);

  // Vertical-aware title — Care Connect → "Care Assistant", banking → "banking
  // assistant", retail → fall back to identity.displayName. Config-page title
  // is unchanged below.
  const verticalAgentTitle = terminology?.agent
    ? `AI ${terminology.agent}`
    : identity?.displayName
      ? `AI ${identity.displayName} assistant`
      : 'AI assistant';
  const hostRefCb = useCallback((el) => setHostEl(el), []);
  useEffect(() => {
    setSurfaceHostEl(hostEl);
    return () => {
      setSurfaceHostEl((cur) => (cur === hostEl ? null : cur));
    };
  }, [hostEl, setSurfaceHostEl]);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const [dockHeight, setDockHeight] = useState(() =>
    typeof window !== 'undefined' ? readStoredHeight() : DEFAULT_HEIGHT
  );
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(dockHeight)));
    } catch {
      /* ignore */
    }
  }, [dockHeight]);

  useEffect(() => {
    const onResize = () => {
      const maxH = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
      setDockHeight((h) => Math.min(h, maxH));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Resize: expand bottom agent on config page — collapsed toolbar looked like "no real agent".
  useEffect(() => {
    if (pathname.replace(/\/$/, '') === '/config') setCollapsed(false);
  }, [pathname]);

  useEffect(() => {
    fetch('/api/admin/feature-flags', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const flag = data?.flags?.find((f) => f.id === 'llm_framework');
        if (flag?.value) setFrameworkLabel(FRAMEWORK_LABELS[flag.value] ?? flag.value);
      })
      .catch(() => {});
  }, []);

  // Holds the teardown for an in-flight resize drag so it can be invoked on
  // unmount — otherwise unmounting mid-drag leaks the document listeners and
  // leaves body cursor/userSelect overridden (stuck ns-resize, no text select).
  const dragCleanupRef = useRef(null);

  const onResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = dockHeight;

      const onMove = (ev) => {
        const delta = startY - ev.clientY;
        const maxH = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
        setDockHeight(Math.min(maxH, Math.max(MIN_HEIGHT, startH + delta)));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = onUp;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [dockHeight]
  );

  // Restore document state if the component unmounts while a drag is in flight.
  useEffect(() => () => {
    if (dragCleanupRef.current) dragCleanupRef.current();
  }, []);

  const onBottomDockRoute =
    agentPlacement === 'bottom' && isEmbeddedAgentDockRoute(pathname);
  const authenticatedStandardDock = Boolean(user) && onBottomDockRoute;

  if (!authenticatedStandardDock) {
    // Guest on a bottom-dock route: no agent portals into the dock (App gates
    // that on a signed-in user), so show a login prompt instead of nothing.
    if (!user && onBottomDockRoute) {
      return (
        <div
          className="global-embedded-agent-dock-wrap refined-dock rd2-dock"
          role="region"
          aria-label="Assistant"
        >
          <div className="embedded-agent-dock-guest-prompt">
            Please sign in to use the Agent
          </div>
        </div>
      );
    }
    return null;
  }

  const isConfigPage = resolveEmbeddedFocus(pathname) === 'config';

  const dockNode = (
    <>
      <TokenExchangeModal
        isOpen={exchangeModalOpen}
        onClose={() => setExchangeModalOpen(false)}
      />
    <div
      className={`global-embedded-agent-dock-wrap refined-dock rd2-dock${collapsed ? ' global-embedded-agent-dock-wrap--collapsed' : ''}`}
      role="region"
      aria-label={isConfigPage ? 'Application setup assistant' : verticalAgentTitle}
      data-agent-ui="embedded"
    >
      {/* Resize handle sits at the very top — acts as the visual seam between content and dock */}
      {!collapsed && (
        <button
          type="button"
          className="embedded-dock-resize-handle"
          onMouseDown={onResizeMouseDown}
          aria-label="Drag up or down to resize assistant height"
        >
          <span className="embedded-dock-resize-handle__grip" aria-hidden>
            <span className="embedded-dock-resize-handle__bar" />
          </span>
          <span className="embedded-dock-resize-handle__label">Resize height</span>
        </button>
      )}

      <div
        className="embedded-agent-dock__toolbar"
        style={{
          minHeight: 44,
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="embedded-agent-dock__head">
          <h2 className="embedded-agent-dock__title">
            {isConfigPage ? 'Application setup assistant' : verticalAgentTitle}
            {!isConfigPage && frameworkLabel && (
              <span className="embedded-agent-dock__framework-badge">{frameworkLabel}</span>
            )}
          </h2>
        </div>
        <div className="embedded-agent-dock__toolbar-actions">
          <button
            type="button"
            className="embedded-dock-graph-link-btn"
            onClick={() => setExchangeModalOpen(true)}
            title="View token exchanges"
            aria-label="View token exchanges"
          >
            Token Exchanges
          </button>
          <button
            type="button"
            className="embedded-dock-graph-link-btn"
            onClick={() => navigate('/telemetry')}
            title="View system graph"
            aria-label="View system graph"
          >
            Graph
          </button>
          <button
            type="button"
            className="embedded-dock-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand assistant' : 'Collapse assistant'}
            aria-label={collapsed ? 'Expand assistant' : 'Collapse assistant'}
          >
            {collapsed ? '▴' : '▾'}
          </button>
        </div>
      </div>

      {/* Host div is ALWAYS mounted so the BankingAgent portal target / its
          React subtree (in-flight chat state) never unmounts on collapse.
          When collapsed it is hidden via CSS (display:none) while staying in
          the DOM — React keeps the portaled subtree mounted regardless. */}
      <div
        className={`embedded-agent-dock embedded-banking-agent embedded-banking-agent--bottom${
          collapsed ? ' embedded-agent-dock--collapsed' : ''
        }`}
        style={{ '--embedded-dock-height': `${Math.round(dockHeight)}px` }}
      >
        <FootprintChrome
          category={fpCategory}
          variant={fpVariant}
          hostRef={hostRefCb}
          preview={false}
        />
      </div>
      </div>
    </>
  );

  return dockNode;
}
