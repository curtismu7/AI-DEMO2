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
  // Set when a run was bound via the banking-agent-prefill event (Use Cases
  // workbench Run) rather than navigate state. The workbench does not navigate
  // on Run — the user then routes to /dashboard with no state, which the
  // location effect below would otherwise treat as "not a launch" and CLEAR
  // the binding the event just created.
  const eventBoundRef = useRef(false);

  useEffect(() => {
    const nextRunContext = runContextFromLocation(location);
    if (nextRunContext) {
      launchedThisMountRef.current = true;
      eventBoundRef.current = false;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    } else if (location?.pathname === '/dashboard') {
      if (launchedThisMountRef.current && !eventBoundRef.current) {
        // Same-session route transition back to /dashboard with no state —
        // not a launch, keep the prior behavior of clearing.
        setRunContext(null);
      } else {
        // Full page load straight onto /dashboard (router state is gone), or a
        // workbench Run (event-bound) followed by routing here: restore the
        // launch binding from the session copy.
        setRunContext(readPersistedRunContext());
      }
    }
  }, [location?.pathname, location?.state]);

  useEffect(() => {
    // Use Cases workbench "Run" does not navigate — it dispatches
    // banking-agent-prefill { message, autoSend, useCaseId }. Without this
    // listener the run-context card stayed "No use case selected" for every
    // event-driven launch (only deep-link navigations bound a run).
    const handler = (e) => {
      const useCaseId = e.detail?.useCaseId;
      if (!useCaseId) return;
      const nextRunContext = {
        source: 'use-cases',
        useCaseId,
        triggerText: e.detail?.message,
      };
      launchedThisMountRef.current = true;
      eventBoundRef.current = true;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    };
    const onTrackStepPick = (e) => {
      const step = e.detail?.step;
      if (!step?.stepId) return;
      const nextRunContext = {
        source: 'demo-track',
        useCaseId: step.stepId,
        useCaseLabel: step.title,
        triggerText: step.buyerStory,
      };
      launchedThisMountRef.current = true;
      eventBoundRef.current = true;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    };
    window.addEventListener('banking-agent-prefill', handler);
    window.addEventListener('agent-track-step-pick', onTrackStepPick);
    return () => {
      window.removeEventListener('banking-agent-prefill', handler);
      window.removeEventListener('agent-track-step-pick', onTrackStepPick);
    };
  }, []);

  return runContext;
}
