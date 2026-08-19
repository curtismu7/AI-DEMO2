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
          // Not concluded yet: the /active follow-up below may still name one.
          verticalStatus: 'loading',
        });
        // Then learn WHICH vertical the server considers active. /me is session-only,
        // so a guest hydrated activeId=null and the UI fell back to its own default
        // while the server independently used the process-global — the two described
        // different verticals, and an A&F picker returned a workforce office couch.
        //
        // Deliberately NOT awaited: hydration above must not block on a secondary
        // lookup. Awaiting it wedged first render for 30s wherever this endpoint is
        // unmocked (caught by App.structure.test.js), and a guest seeing the picker
        // a tick later is far better than a page that will not paint.
        fetch('/api/verticals/active', { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const id = d && d.id;
            setState((cur) => {
              if (!cur) return cur;
              const next = { ...cur, verticalStatus: 'resolved' };
              if (id && !cur.activeId) next.activeId = id;
              return next;
            });
          })
          .catch(() => {
            // Keep activeId null, but the question is now ANSWERED (no vertical) —
            // consumers waiting on the resolution must not keep waiting.
            setState((cur) => (cur ? { ...cur, verticalStatus: 'resolved' } : cur));
          });
        return;
      }
      const data = await res.json();
      setState({ ...data, verticalStatus: 'resolved' });
      if (data.pageManifest) {
        themeKeysRef.current = applyThemeTokens(data.pageManifest.theme.cssVars, themeKeysRef.current);
        document.title = data.pageManifest.identity.documentTitle
          || `${data.pageManifest.identity.displayName} · PingOne AI`;
      }
    } catch (_) {
      // Network errors: hydrate with empty state so children render. SSE will
      // trigger another refetch when the server becomes reachable.
      setState((cur) => ({
        activeId: cur?.activeId ?? null,
        pageManifest: cur?.pageManifest ?? null,
        pageMockData: cur?.pageMockData ?? null,
        adminManifest: cur?.adminManifest ?? null,
        isAdmin: cur?.isAdmin ?? false,
        // Concluded, unsuccessfully — waiting longer will not produce a vertical
        // until SSE triggers a refetch.
        verticalStatus: 'failed',
      }));
    }
  }, []);

  const refetch = useTrailingThrottle(doFetch, 250);

  // Both /api/verticals/stream and /api/verticals/me require a session; before
  // one exists they only 401. This provider sits above the component that owns
  // useAuth, so the session signal arrives as the `userAuthenticated` event
  // useAuth dispatches once a session is confirmed.
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    const onAuth = () => setAuthed(true);
    window.addEventListener('userAuthenticated', onAuth);
    return () => window.removeEventListener('userAuthenticated', onAuth);
  }, []);

  useEffect(() => {
    if (!authed) {
      refetch();
      const guestFallback = setTimeout(() => {
        setState((cur) => cur ?? {
          activeId: null,
          pageManifest: null,
          pageMockData: null,
          adminManifest: null,
          isAdmin: false,
          verticalStatus: 'resolved',
        });
      }, 1500);
      return () => clearTimeout(guestFallback);
    }
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
  }, [authed, refetch]);

  if (!state) return null;
  return (
    <VerticalContext.Provider value={{ ...state, refetch: doFetch }}>
      {children}
    </VerticalContext.Provider>
  );
}
