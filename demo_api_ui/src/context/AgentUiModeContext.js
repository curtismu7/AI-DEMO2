// banking_api_ui/src/context/AgentUiModeContext.js
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY_LEGACY = 'banking_agent_ui_mode';
const STORAGE_KEY_V2 = 'banking_agent_ui_v2';

/**
 * @typedef {object} AgentUiState
 * @property {'middle' | 'bottom' | 'none'} placement — Middle = split-column agent host; bottom = full-width dashboard with agent dock at bottom; none = float-only.
 * @property {boolean} fab — Also show floating FAB on dashboard routes (invalid with placement none unless true).
 */

const defaultState = /** @type {AgentUiState} */ ({
  placement: 'middle',
  fab: true,
  mode: null,
});

function readLegacyMode() {
  try {
    const m = localStorage.getItem(STORAGE_KEY_LEGACY);
    if (m === 'embedded') return { placement: 'middle', fab: false };
    if (m === 'both') return { placement: 'middle', fab: true };
    return { placement: 'middle', fab: true };
  } catch {
    return { ...defaultState };
  }
}

/** Keep ThemeContext + older code that reads `banking_agent_ui_mode` in sync. */
function syncLegacyString(state) {
  try {
    if (state.placement === 'none') {
      localStorage.setItem(STORAGE_KEY_LEGACY, 'floating');
      return;
    }
    if (state.placement === 'middle' && !state.fab) {
      localStorage.setItem(STORAGE_KEY_LEGACY, 'embedded');
      return;
    }
    localStorage.setItem(STORAGE_KEY_LEGACY, 'both');
  } catch {
    /* ignore */
  }
}

/**
 * @returns {AgentUiState}
 */
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const o = JSON.parse(raw);
      const p = o?.placement;
      const fab = o?.fab;
      const mode = typeof o?.mode === 'string' ? o.mode : null;
      if ((p === 'middle' || p === 'bottom' || p === 'none') && typeof fab === 'boolean') {
        if (p === 'none' && !fab) {
          return { placement: 'none', fab: true, mode };
        }
        return { placement: p, fab, mode };
      }
      // Any persisted placement outside the valid {middle, bottom, none} set —
      // including the older 'right-dock' / 'left-dock' — coerces to middle so a
      // persisted value never yields a no-agent state. Other unknown placements
      // fall through to readLegacyMode() below.
      if (p === 'right-dock' || p === 'left-dock') {
        return { placement: 'middle', fab: typeof fab === 'boolean' ? fab : true, mode };
      }
    }
  } catch {
    /* fall through */
  }
  return { ...readLegacyMode(), mode: null };
}

const AgentUiModeContext = createContext({
  placement: 'middle',
  fab: true,
  mode: null,
  setAgentUi: () => {},
  webMcpLastResult: null,
  setWebMcpLastResult: () => {},
  surfaceHostEl: null,
  setSurfaceHostEl: () => {},
  // Registered by a host page that wants the agent's header control row rendered
  // outside the agent column (see LiveUseCaseWorkbenchPage). Null everywhere else,
  // which keeps every other surface on the inline header.
  toolbarHostEl: null,
  setToolbarHostEl: () => {},
  // ff_agent_clinical_split: TalkPane sets true on mount so App.js renders
  // BankingAgent with mode="inline" + splitColumnChrome (existing
  // .ba-mode-inline styles); cleared on unmount so the legacy floating dock
  // returns elsewhere.
  clinicalSplit: false,
  setClinicalSplit: () => {},
});

/**
 * Middle — embedded assistant in dashboard split column (token | agent | banking).
 * Float — corner FAB only (no embedded chrome); fab is always true.
 * fab — when Middle, also show the floating FAB (Middle+Float).
 */
export function AgentUiModeProvider({ children }) {
  const [state, setState] = useState(() => readState());
  const [webMcpLastResult, setWebMcpLastResult] = useState(null);
  const [surfaceHostEl, setSurfaceHostEl] = useState(null);
  const [toolbarHostEl, setToolbarHostEl] = useState(null);

  // clinicalSplit is registered by TalkPane (setClinicalSplit(true) on mount,
  // setClinicalSplit(false) on unmount). Ownership-safe via a ref-count: React
  // StrictMode double-invokes effects (mount->cleanup->mount) and a route/skin
  // swap can briefly overlap two TalkPanes — a plain boolean lets the losing/first
  // cleanup's setClinicalSplit(false) clear the mode while a live TalkPane still
  // owns it, which drops App back to float chrome, unmounts the TalkPane host, and
  // leaves the agent unportaled (hidden). Counting registrations keeps the mode ON
  // until the LAST owner unmounts.
  const clinicalSplitCountRef = useRef(0);
  const [clinicalSplit, setClinicalSplitState] = useState(false);
  const setClinicalSplit = useCallback((on) => {
    clinicalSplitCountRef.current = Math.max(0, clinicalSplitCountRef.current + (on ? 1 : -1));
    setClinicalSplitState(clinicalSplitCountRef.current > 0);
  }, []);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY_V2)) {
        const s = readState();
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(s));
      }
      syncLegacyString(readState());
    } catch {
      /* ignore */
    }
  }, []);

  const setAgentUi = useCallback((next) => {
    setState((prev) => {
      const placement = next.placement !== undefined ? next.placement : prev.placement;
      let fab = next.fab !== undefined ? next.fab : prev.fab;
      const mode = next.mode !== undefined ? next.mode : prev.mode;
      if (placement === 'none') {
        fab = true;
      }
      const out = { placement, fab, mode };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(out));
      } catch {
        /* ignore */
      }
      syncLegacyString(out);
      return out;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY_V2 || e.newValue == null) return;
      try {
        const o = JSON.parse(e.newValue);
        if (o?.placement && typeof o.fab === 'boolean') {
          setState(o);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({
      placement: state.placement,
      fab: state.fab,
      mode: state.mode,
      setAgentUi,
      webMcpLastResult,
      setWebMcpLastResult,
      surfaceHostEl,
      setSurfaceHostEl,
      toolbarHostEl,
      setToolbarHostEl,
      clinicalSplit,
      setClinicalSplit,
    }),
    // useState setters are stable refs (excluded); setClinicalSplit is a stable
    // useCallback([]) but listed to satisfy react-hooks/exhaustive-deps.
    [state.placement, state.fab, state.mode, setAgentUi, webMcpLastResult, surfaceHostEl, toolbarHostEl, clinicalSplit, setClinicalSplit]
  );

  return (
    <AgentUiModeContext.Provider value={value}>{children}</AgentUiModeContext.Provider>
  );
}

export function useAgentUiMode() {
  return useContext(AgentUiModeContext);
}
