import { useEffect, useRef, useState } from 'react';

export const RUN_CONTEXT_STORAGE_KEY = 'bx_run_context';

function persistRunContext(runContext) {
  try {
    sessionStorage.setItem(RUN_CONTEXT_STORAGE_KEY, JSON.stringify(runContext));
  } catch {
    // sessionStorage may be unavailable (private mode / policy)
  }
}

function readPersistedRunContext() {
  try {
    const raw = sessionStorage.getItem(RUN_CONTEXT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function runContextFromLocation(location) {
  const state = location?.state;
  if (!state?.triggerText || (!state.runContext && !state.useCaseId)) return null;

  return state.runContext || {
    source: 'use-cases',
    useCaseId: state.useCaseId,
    triggerText: state.triggerText,
  };
}

export function useUseCaseRunContext(location) {
  const [runContext, setRunContext] = useState(null);
  // Set once the launch on THIS mount has been consumed; a later same-session
  // route transition with no state then clears. After a full page load
  // (reload / OAuth sign-in redirect) the ref starts false again, so /dashboard
  // restores the session copy of the last launch.
  const launchedThisMountRef = useRef(false);

  useEffect(() => {
    const nextRunContext = runContextFromLocation(location);
    if (nextRunContext) {
      launchedThisMountRef.current = true;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    } else if (location?.pathname === '/dashboard') {
      if (launchedThisMountRef.current) {
        // Same-session route transition back to /dashboard with no state —
        // not a launch, keep the prior behavior of clearing.
        setRunContext(null);
      } else {
        // Full page load straight onto /dashboard: router state is gone, so
        // restore the launch binding from the session copy.
        setRunContext(readPersistedRunContext());
      }
    }
  }, [location?.pathname, location?.state]);

  return runContext;
}
