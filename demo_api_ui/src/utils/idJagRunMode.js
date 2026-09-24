import { createMockIdJagTrace } from './idJagMockTrace';

export const ID_JAG_USE_CASE_ID = 'enterprise-managed-mcp-authorization';
export const RUN_MODES = Object.freeze({
  LIVE_ID_JAG: 'live-id-jag',
  MOCK_ID_JAG: 'mock-id-jag',
  STANDARD: 'standard',
});

export const ID_JAG_PENDING_INTENT_KEY = 'bx_id_jag_pending_intent';
export const USE_CASE_RUN_CONTEXT_KEY = 'bx_use_case_run_context';

export function isIdJagRunMode(mode) {
  return mode === RUN_MODES.LIVE_ID_JAG || mode === RUN_MODES.MOCK_ID_JAG;
}

export function createIdJagLaunchIntent({ mode, message, returnTo } = {}) {
  if (!isIdJagRunMode(mode)) throw new Error('Invalid ID-JAG run mode');
  if (typeof message !== 'string' || !message.trim() || message.length > 256 || /[\x00-\x1f\x7f]/.test(message)) {
    throw new Error('Invalid ID-JAG message');
  }
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')
    || returnTo.length > 256 || /[\\\x00-\x1f\x7f#]/.test(returnTo) || /%2f|%5c/i.test(returnTo)) {
    throw new Error('Invalid ID-JAG return path');
  }
  const parsed = new URL(returnTo, 'https://id-jag.invalid');
  if (parsed.origin !== 'https://id-jag.invalid' || parsed.pathname === '//') {
    throw new Error('Invalid ID-JAG return path');
  }
  return { useCaseId: ID_JAG_USE_CASE_ID, mode, message: message.trim(), returnTo: parsed.pathname + parsed.search };
}

export function requestLiveIdJagRun(detail) {
  const intent = createIdJagLaunchIntent(detail);
  if (intent.mode !== RUN_MODES.LIVE_ID_JAG) throw new Error('Live ID-JAG mode required');
  window.dispatchEvent(new CustomEvent('id-jag-run-requested', { detail: intent }));
  return intent;
}

export function requestMockIdJagReplay() {
  const trace = createMockIdJagTrace();
  window.dispatchEvent(new CustomEvent('id-jag-mock-replay-requested', { detail: trace }));
  return trace;
}

export function clearIdJagRunState() {
  try {
    sessionStorage.removeItem(ID_JAG_PENDING_INTENT_KEY);
    const raw = sessionStorage.getItem(USE_CASE_RUN_CONTEXT_KEY);
    if (raw) {
      const context = JSON.parse(raw);
      if (context && typeof context === 'object' && isIdJagRunMode(context.mode)) {
        const { mode: _mode, ...ordinaryContext } = context;
        sessionStorage.setItem(USE_CASE_RUN_CONTEXT_KEY, JSON.stringify(ordinaryContext));
      }
    }
  } catch {
    // Storage can be disabled; the event still clears in-memory subscribers.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('id-jag-run-cleared'));
}
