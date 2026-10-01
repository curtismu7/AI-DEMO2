import { createMockIdJagTrace } from './idJagMockTrace';

export const ID_JAG_USE_CASE_ID = 'enterprise-managed-mcp-authorization';
export const RUN_MODES = Object.freeze({
  LIVE_ID_JAG: 'live-id-jag',
  MOCK_ID_JAG: 'mock-id-jag',
  STANDARD: 'standard',
});

export const ID_JAG_PENDING_INTENT_KEY = 'bx_id_jag_pending_intent';
export const ID_JAG_REPLAYED_KEY = 'bx_id_jag_replayed';
export const ID_JAG_VALIDATED_CALLBACK_KEY = 'bx_id_jag_validated_callback';
// Shared with the agent's existing use-case run-context hook.
export const USE_CASE_RUN_CONTEXT_KEY = 'bx_run_context';
// Pre-run login provider (2026-09-26): a live ID-JAG run requires the
// PingFederate provider, and the demo leaves the user on it afterwards —
// silently losing whatever they had selected before. Capture the provider at
// launch and auto-restore it once the run completes so "what I chose before
// the demo" survives the demo.
export const ID_JAG_PRE_RUN_PROVIDER_KEY = 'bx_id_jag_pre_run_provider';

let liveLaunchPending = false;
let providerRestoreGeneration = 0;
const providerRestorePromises = new Set();

/**
 * Mirrors the BFF's ID_JAG_RUN_TTL_MS (routes/oauthUser.js) — a pending intent
 * older than this cannot be redeemed server-side, so keeping its guard up only
 * deadlocks future launches (the silent "clicked the button and nothing
 * happened" failure mode).
 */
const PENDING_INTENT_TTL_MS = 5 * 60 * 1000;

function readStoredIntent() {
  try {
    const raw = sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    // Unparseable garbage can never be redeemed — treat as stale.
    try { sessionStorage.removeItem(ID_JAG_PENDING_INTENT_KEY); } catch { /* ignore */ }
    return null;
  }
}

/** True when a stored intent has outlived the server-side redemption window. */
function isIntentStale(intent) {
  const createdAt = Number(intent?.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return true;
  return Date.now() - createdAt >= PENDING_INTENT_TTL_MS;
}

/**
 * Tells subscribers a previous launch attempt is still considered pending and
 * was NOT started by this click — never a silent no-op.
 */
function notifyLaunchBlocked(reason) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('id-jag-launch-blocked', { detail: { reason } }));
  }
}

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
  // Recovery path: a stale pending intent (crashed launch, TTL exceeded,
  // pre-fix page) can never be redeemed server-side — drop it and proceed
  // instead of deadlocking every future click.
  try {
    const stored = readStoredIntent();
    if (stored && isIntentStale(stored)) {
      sessionStorage.removeItem(ID_JAG_PENDING_INTENT_KEY);
      liveLaunchPending = false;
    }
  } catch { /* storage unavailable — in-memory guard still applies */ }
  if (liveLaunchPending) {
    notifyLaunchBlocked('launch_in_progress');
    return null;
  }
  try {
    if (sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)) {
      notifyLaunchBlocked('intent_pending');
      return null;
    }
    sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ ...intent, createdAt: Date.now() }));
    capturePreRunProvider();
  } catch {
    // The in-memory guard still prevents duplicate launches in this page.
  }
  liveLaunchPending = true;
  window.dispatchEvent(new CustomEvent('id-jag-run-requested', { detail: intent }));
  return intent;
}

/** Release the client handoff guard after a validated callback; retain run context. */
export function completeIdJagRunHandoff({ restoreProvider = true } = {}) {
  const generation = ++providerRestoreGeneration;
  liveLaunchPending = false;
  try { sessionStorage.removeItem(ID_JAG_PENDING_INTENT_KEY); } catch { /* storage unavailable */ }
  if (!restoreProvider) {
    try { sessionStorage.removeItem(ID_JAG_PRE_RUN_PROVIDER_KEY); } catch { /* storage unavailable */ }
    return;
  }
  const restorePromise = restorePreRunProvider(generation);
  providerRestorePromises.add(restorePromise);
  void restorePromise.finally(() => providerRestorePromises.delete(restorePromise));
}

/**
 * Remember the login provider in effect before a live ID-JAG run started, so
 * it can be put back when the run is over. Reads the same admin config the
 * provider toggle uses; a failed read simply means nothing to restore.
 */
async function capturePreRunProvider() {
  const generation = providerRestoreGeneration;
  try {
    const res = await fetch('/api/admin/config', { credentials: 'same-origin' });
    if (!res.ok) return;
    const body = await res.json();
    const provider = body?.config?.oauth_provider;
    if (generation === providerRestoreGeneration && (provider === 'pingone' || provider === 'pingfederate')) {
      sessionStorage.setItem(ID_JAG_PRE_RUN_PROVIDER_KEY, provider);
    }
  } catch { /* capture is best-effort — the run proceeds regardless */ }
}

/**
 * Put the pre-run provider back. Returns true when a restore was issued (the
 * caller should expect a reload). Silent no-ops: nothing captured, provider
 * already matches, config write rejected (non-admin), or storage unavailable.
 */
async function restorePreRunProvider(generation) {
  if (generation !== providerRestoreGeneration) return false;
  let previous = null;
  try { previous = sessionStorage.getItem(ID_JAG_PRE_RUN_PROVIDER_KEY); } catch { return false; }
  if (previous !== 'pingone' && previous !== 'pingfederate') return false;
  try { sessionStorage.removeItem(ID_JAG_PRE_RUN_PROVIDER_KEY); } catch { /* leave it; restore is one-shot */ }
  try {
    const res = await fetch('/api/admin/config', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body = await res.json();
    if (generation !== providerRestoreGeneration) return false;
    const current = body?.config?.oauth_provider;
    if (!current || current === previous) return false;
    const write = await fetch('/api/admin/config', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oauth_provider: previous }),
    });
    if (!write.ok) return false;
    if (generation !== providerRestoreGeneration) return false;
    await fetch('/api/auth/clear-session', { method: 'POST', credentials: 'same-origin' });
    if (generation !== providerRestoreGeneration) return false;
    window.dispatchEvent(new CustomEvent('userLoggedOut'));
    window.location.reload();
    return true;
  } catch { return false; }
}

export function requestMockIdJagReplay() {
  const trace = createMockIdJagTrace();
  window.dispatchEvent(new CustomEvent('id-jag-mock-replay-requested', { detail: trace }));
  return trace;
}

function clearIdJagRunStorage() {
  try { sessionStorage.removeItem(ID_JAG_REPLAYED_KEY); } catch { /* storage unavailable */ }
  try { sessionStorage.removeItem(ID_JAG_VALIDATED_CALLBACK_KEY); } catch { /* storage unavailable */ }
  try {
    const raw = sessionStorage.getItem(USE_CASE_RUN_CONTEXT_KEY);
    if (raw) {
      const context = JSON.parse(raw);
      if (context?.useCaseId === ID_JAG_USE_CASE_ID) {
        sessionStorage.removeItem(USE_CASE_RUN_CONTEXT_KEY);
      } else if (context && typeof context === 'object' && isIdJagRunMode(context.mode)) {
        const { mode: _mode, ...ordinaryContext } = context;
        sessionStorage.setItem(USE_CASE_RUN_CONTEXT_KEY, JSON.stringify(ordinaryContext));
      }
    }
  } catch {
    // Storage can be disabled; the event still clears in-memory subscribers.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('id-jag-run-cleared'));
}

export function clearIdJagRunState({ preservePending = false } = {}) {
  if (!preservePending) completeIdJagRunHandoff();
  clearIdJagRunStorage();
}

/** Clear a handoff before switching providers without restoring its saved provider. */
export async function clearIdJagRunStateForProviderSwitch() {
  completeIdJagRunHandoff({ restoreProvider: false });
  await Promise.allSettled([...providerRestorePromises]);
  try { sessionStorage.removeItem(ID_JAG_PRE_RUN_PROVIDER_KEY); } catch { /* storage unavailable */ }
  clearIdJagRunStorage();
}
