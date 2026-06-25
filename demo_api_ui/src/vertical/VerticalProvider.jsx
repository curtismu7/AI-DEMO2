import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { applyThemeTokens } from './applyThemeTokens';

export const VerticalContext = createContext(null);

// Trailing throttle: leading call runs immediately; bursts within `delay` ms
// collapse into one trailing call.
function useTrailingThrottle(fn, delay) {
  const timer = useRef(null);
  const pending = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args) => {
    if (timer.current) { pending.current = true; return; }
    fnRef.current(...args);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current) { pending.current = false; fnRef.current(...args); }
    }, delay);
  }, [delay]);
}

export function VerticalProvider({ children }) {
  const [state, setState] = useState(null);
  // Keys applied by the last applyThemeTokens call, scoped to this provider
  // instance (no module-level shared state).
  const themeKeysRef = useRef(new Set());

  const doFetch = useCallback(async () => {
    try {
      const res = await fetch('/api/verticals/me', { credentials: 'include' });
      if (!res.ok) {
        // 401 (unauthenticated) is normal on landing/login/marketing pages.
        // Hydrate with an empty state so children can still render.
        setState({
          activeId: null,
          pageManifest: null,
          pageMockData: null,
          adminManifest: null,
          isAdmin: false,
        });
        return;
      }
      const data = await res.json();
      setState(data);
      if (data.pageManifest) {
        themeKeysRef.current = applyThemeTokens(data.pageManifest.theme.cssVars, themeKeysRef.current);
        document.title = data.pageManifest.identity.documentTitle
          || `${data.pageManifest.identity.displayName} · PingOne AI`;
      }
    } catch (_) {
      // Network errors: hydrate with empty state so children render. SSE will
      // trigger another refetch when the server becomes reachable.
      setState((cur) => cur ?? {
        activeId: null,
        pageManifest: null,
        pageMockData: null,
        adminManifest: null,
        isAdmin: false,
      });
    }
  }, []);

  const refetch = useTrailingThrottle(doFetch, 250);

  useEffect(() => {
    // The server sends an initial `vertical-switched` on stream connect as a
    // hydration optimization, so we don't eagerly refetch — that event drives
    // the first /me. Fallback: if the stream 401s (logged out) or no event
    // arrives, hydrate after a short delay so the page never stays blank.
    let hydrated = false;
    const hydrate = () => { hydrated = true; refetch(); };
    const es = new EventSource('/api/verticals/stream', { withCredentials: true });
    es.addEventListener('vertical-switched', hydrate);
    es.addEventListener('vertical-edited', hydrate);
    es.addEventListener('vertical-list-changed', () => {
      window.dispatchEvent(new CustomEvent('vertical-list-changed'));
    });
    const fallback = setTimeout(() => { if (!hydrated) refetch(); }, 1500);
    return () => { clearTimeout(fallback); es.close(); };
  }, [refetch]);

  if (!state) return null;
  return (
    <VerticalContext.Provider value={{ ...state, refetch: doFetch }}>
      {children}
    </VerticalContext.Provider>
  );
}
