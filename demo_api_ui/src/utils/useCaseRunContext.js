import { useEffect, useRef, useState } from 'react';
import {
  ID_JAG_USE_CASE_ID,
  RUN_MODES,
  USE_CASE_RUN_CONTEXT_KEY,
  clearIdJagRunState,
  completeIdJagRunHandoff,
  isIdJagRunMode,
} from './idJagRunMode';

export const RUN_CONTEXT_STORAGE_KEY = USE_CASE_RUN_CONTEXT_KEY;

function withIdJagMode(context, mode) {
  if (context?.useCaseId !== ID_JAG_USE_CASE_ID || !isIdJagRunMode(mode)) return context;
  return { ...context, mode };
}

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

function isBrowserReload() {
  try {
    return window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  } catch {
    return false;
  }
}

export function runContextFromLocation(location) {
  const state = location?.state;
  if (!state?.triggerText || (!state.runContext && !state.useCaseId)) return null;

  return withIdJagMode(state.runContext || {
    source: 'use-cases',
    useCaseId: state.useCaseId,
    triggerText: state.triggerText,
  }, state.mode);
}

export function useUseCaseRunContext(location) {
  const [runContext, setRunContext] = useState(null);
  const browserReloadRef = useRef(isBrowserReload());
  // Set once the launch on THIS mount has been consumed; a later same-session
  // route transition with no state then clears.
  const launchedThisMountRef = useRef(false);
  // Set when a run was bound by an event rather than navigate state. These
  // launches do not navigate, so a later route to /dashboard has no state; the
  // location effect below must preserve the event-bound context.
  const eventBoundRef = useRef(false);

  useEffect(() => {
    const isDashboardOAuthReturn = new URLSearchParams(location?.search || '').get('oauth') === 'success';
    if (location?.pathname === '/dashboard' && browserReloadRef.current && !isDashboardOAuthReturn) {
      try {
        sessionStorage.removeItem(RUN_CONTEXT_STORAGE_KEY);
      } catch {
        // sessionStorage may be unavailable (private mode / policy)
      }
      setRunContext(null);
      return;
    }

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
        // OAuth returns and event-bound launches may restore the
        // launch binding from the session copy.
        setRunContext(readPersistedRunContext());
      }
    }
  }, [location?.pathname, location?.search, location?.state]);

  useEffect(() => {
    // Use Cases workbench "Run" does not navigate — it dispatches
    // banking-agent-prefill { message, autoSend, useCaseId }. Without this
    // listener the run-context card stayed "No use case selected" for every
    // event-driven launch (only deep-link navigations bound a run).
    const handler = (e) => {
      const useCaseId = e.detail?.useCaseId;
      if (!useCaseId) return;
      const nextRunContext = withIdJagMode({
        source: 'use-cases',
        useCaseId,
        useCaseLabel: e.detail?.useCaseTitle,
        triggerText: e.detail?.message,
      }, e.detail?.mode);
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
    const onDemoStepSelect = (e) => {
      const uc = e.detail?.uc;
      if (!uc) return;
      const nextRunContext = {
        source: 'demo-steps',
        useCaseId: uc.useCaseId || uc.id,
        useCaseLabel: uc.title,
        triggerText: uc.trigger?.text,
      };
      launchedThisMountRef.current = true;
      eventBoundRef.current = true;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    };
    const onPromptRun = (e) => {
      const prompt = e.detail?.prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      const useCaseId = e.detail?.useCaseId || null;
      // A selected scenario already carries its proper title and launch
      // source from the selection event. Preserve that binding; only freeform
      // dashboard prompts need a new title here.
      if (useCaseId) return;
      const nextRunContext = {
        source: 'dashboard',
        useCaseId: null,
        useCaseLabel: prompt.trim(),
        triggerText: prompt.trim(),
      };
      launchedThisMountRef.current = true;
      eventBoundRef.current = true;
      persistRunContext(nextRunContext);
      setRunContext(nextRunContext);
    };
    const onIdJagRunCleared = () => {
      setRunContext((current) => {
        if (current?.useCaseId === ID_JAG_USE_CASE_ID) return null;
        if (!isIdJagRunMode(current?.mode)) return current;
        const { mode: _mode, ...ordinaryContext } = current;
        return ordinaryContext;
      });
    };
    const onAuthBoundary = (event) => {
      const detail = event.detail;
      const validCallback = event.type === 'userAuthenticated'
        && detail?.idJagCallbackValidated === true
        && detail?.useCaseId === ID_JAG_USE_CASE_ID
        && detail?.mode === RUN_MODES.LIVE_ID_JAG;
      if (validCallback) completeIdJagRunHandoff();
      else clearIdJagRunState({ preservePending: event.type === 'userLoggedOut' && detail?.idJagHandoff === true });
    };
    window.addEventListener('banking-agent-prefill', handler);
    window.addEventListener('agent-track-step-pick', onTrackStepPick);
    window.addEventListener('agent-demo-step-select', onDemoStepSelect);
    window.addEventListener('agent-prompt-run', onPromptRun);
    window.addEventListener('id-jag-run-cleared', onIdJagRunCleared);
    window.addEventListener('userAuthenticated', onAuthBoundary);
    window.addEventListener('userLoggedOut', onAuthBoundary);
    return () => {
      window.removeEventListener('banking-agent-prefill', handler);
      window.removeEventListener('agent-track-step-pick', onTrackStepPick);
      window.removeEventListener('agent-demo-step-select', onDemoStepSelect);
      window.removeEventListener('agent-prompt-run', onPromptRun);
      window.removeEventListener('id-jag-run-cleared', onIdJagRunCleared);
      window.removeEventListener('userAuthenticated', onAuthBoundary);
      window.removeEventListener('userLoggedOut', onAuthBoundary);
    };
  }, []);

  return runContext;
}
