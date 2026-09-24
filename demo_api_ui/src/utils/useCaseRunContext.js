import {
  ID_JAG_USE_CASE_ID,
  ID_JAG_PENDING_INTENT_KEY,
  RUN_MODES,
  USE_CASE_RUN_CONTEXT_KEY,
  clearIdJagRunState,
  isIdJagRunMode,
} from './idJagRunMode';

/** UI replay aid only. The BFF validates live ID-JAG authorization. */
export function getUseCaseRunContext() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(USE_CASE_RUN_CONTEXT_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setUseCaseRunContext(detail) {
  const context = { ...detail };
  if (context.mode === RUN_MODES.STANDARD || !isIdJagRunMode(context.mode)) delete context.mode;
  try {
    sessionStorage.setItem(USE_CASE_RUN_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Context is a replay aid; storage failure must not interrupt login.
  }
  return context;
}

export function clearUseCaseRunContext() {
  try { sessionStorage.removeItem(USE_CASE_RUN_CONTEXT_KEY); } catch { /* storage unavailable */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('userLoggedOut', clearIdJagRunState);
  window.addEventListener('userAuthenticated', (event) => {
    const detail = event.detail;
    const validCallback = detail?.idJagCallbackValidated === true
      && detail?.useCaseId === ID_JAG_USE_CASE_ID
      && detail?.mode === RUN_MODES.LIVE_ID_JAG;
    if (!validCallback) clearIdJagRunState();
    else {
      // The pending browser hint is single-use even when the callback succeeds.
      try { sessionStorage.removeItem(ID_JAG_PENDING_INTENT_KEY); } catch { /* storage unavailable */ }
    }
  });
}
