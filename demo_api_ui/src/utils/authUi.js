// banking_api_ui/src/utils/authUi.js
/** Shared helpers for re-auth CTAs when the UI shows session/login errors. */

import { clearStatusCache } from '../services/cachedStatusService';
import { navigateWithOverlay } from './navigateWithOverlay';
// Circular by design: signInService imports this module's *Raw redirect legs,
// this module's public navigateTo*Login delegate to signInService.openSignIn.
// ESM hoists the function declarations, so both sides resolve.
import { openSignIn } from './signInService';

/** Dispatched with `detail: { message, role: 'admin' | 'customer' }` so `App` can show an on-page banner. */
export const SESSION_REAUTH_EVENT = 'banking-session-reauth';

/** Canonical user-facing copy for session/auth loss (banner + agent chat). */
export const USER_SESSION_EXPIRED_MESSAGE =
  'For a more personalized experience, please sign in.';

const DEFAULT_SESSION_EXPIRED_MESSAGE = USER_SESSION_EXPIRED_MESSAGE;

/**
 * Canonical copy for the sign-in INTERRUPT (SignInModal). Distinct from
 * `USER_SESSION_EXPIRED_MESSAGE`, which is the soft guest-chat nudge: by the
 * time the modal opens the session is provably gone, so say that plainly.
 * Raw provider text ("jwt expired") travels separately as `detail` and is
 * never concatenated onto this sentence.
 */
export const SESSION_EXPIRED_INTERRUPT_MESSAGE =
  'Your session has expired. Sign in again to continue.';

/**
 * The same interrupt, for a visitor who never had a session at all.
 *
 * AUTH_REQUIRED_CODES covers two different states and the copy above is only
 * true for one of them: `session_expired` / `expired_token` / `token_inactive`
 * mean a session existed and lapsed, while `login_required` /
 * `authentication_required` mean there was never one. Telling a first-time
 * visitor their session "expired" is simply false, and it was the visible bug
 * on /pingone-authorize — arrive signed out, get told something ended that
 * never began. SignInModal's own docstring already allows for both ("the
 * session is gone (or was never there)"); only the sentence lagged.
 */
export const SIGN_IN_REQUIRED_INTERRUPT_MESSAGE = 'Sign in to continue.';

/** Codes that mean "never signed in", as opposed to "signed in, then lapsed". */
const NEVER_AUTHENTICATED_CODES = new Set([
  'login_required',
  'authentication_required',
]);

/**
 * Pick the interrupt sentence from what the server actually said.
 * Defaults to the expiry wording, which is the long-standing behaviour and the
 * right answer whenever the code is absent or unrecognised.
 * @param {unknown} body
 * @returns {string}
 */
export function interruptMessageForAuthFailure(body) {
  const raw = body && typeof body === 'object' ? body : {};
  // `error` and `code` both carry it depending on the endpoint; normalizeAuthFailure
  // rewrites them to 'session_expired', so read the ORIGINAL fields first.
  for (const field of [raw.code, raw.error]) {
    if (NEVER_AUTHENTICATED_CODES.has(normalizeErrorCode(field))) {
      return SIGN_IN_REQUIRED_INTERRUPT_MESSAGE;
    }
  }
  return SESSION_EXPIRED_INTERRUPT_MESSAGE;
}

/** Throttle duplicate banners when several API calls 401 at once. */
let lastSessionExpiryNotifyAt = 0;
const SESSION_EXPIRY_NOTIFY_MS = 8000;


/** @internal Reset notify throttle between unit tests. */
export function _resetSessionExpiryNotifyForTests() {
  lastSessionExpiryNotifyAt = 0;
}

/** Machine codes that mean the user must sign in again (not scope/delegation). */
const AUTH_REQUIRED_CODES = new Set([
  'session_expired',
  'expired_token',
  'token_inactive',
  'login_required',
  'authentication_required',
  'unauthenticated',
  'oauth_session_required',
  'session_restore_required',
  'session_not_hydrated',
  'not_authenticated',
  'unauthorized',
  'authentication_failed',
]);

/** 401 codes that are NOT session expiry (keep contextual UI). */
const AUTH_REQUIRED_EXCLUSIONS = new Set([
  'delegation_required',
  'invalid_delegation',
  'admin_required',
  'step_up_required',
  'mcp_step_up_required',
]);

/**
 * Normalize error codes so "Session expired" and "session_expired" match.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeErrorCode(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

/**
 * Routes where a 401 should surface the re-auth banner.
 * Exclude-only: public landing, logout, setup, and the Learning Hub (in-app
 * and web mirror) — every other app path qualifies (embedded agent hosts,
 * use-case pages, etc.). The Hub's content is browsable signed-out; its
 * signed-in features (Ask agent, grounding search) disable themselves
 * instead of interrupting a guest with the sign-in modal.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isAuthenticatedAppSurface(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/' || p === '/logout' || p.startsWith('/setup')) return false;
  if (p === '/learning' || p.startsWith('/learning-mirror')) return false;
  return true;
}

/**
 * True when a BFF 401 JSON body indicates the PingOne access token is no longer valid.
 * Narrower helper kept for callers/tests; prefer `isAuthRequiredApiError` for new code.
 * @param {unknown} body
 * @returns {boolean}
 */
export function isSessionExpiredApiError(body) {
  if (!body || typeof body !== 'object') return false;
  const err = normalizeErrorCode(body.error);
  const desc = String(
    body.error_description || body.message || '',
  ).toLowerCase();
  if (body.requiresLogin === true) return true;
  if (
    err === 'session_expired' ||
    err === 'expired_token' ||
    err === 'token_inactive'
  ) {
    return true;
  }
  if (err === 'invalid_token' || err === 'authentication_failed') {
    return (
      desc.includes('expired') ||
      desc.includes('jwt expired') ||
      desc.includes('no longer valid')
    );
  }
  return desc.includes('jwt expired') || desc.includes('session has expired');
}

/**
 * True when an HTTP 401 means the user must sign in again (session/token gone).
 * Broader than `isSessionExpiredApiError` — covers agent overnight-expiry shapes.
 * @param {number} [status]
 * @param {unknown} [body]
 * @returns {boolean}
 */
export function isAuthRequiredApiError(status, body) {
  if (status !== 401) return false;
  if (!body || typeof body !== 'object') {
    // Bare 401 with no JSON — still treat as auth required on app surfaces.
    return true;
  }

  // A use-case can be protected even while the browser still has a valid
  // session (for example, an admin session attempting a customer-only UC7/UC8
  // step). Keep that typed challenge inline; invalidating the global session
  // here destroys the session the login flow is meant to preserve.
  if (
    typeof body.useCaseId === 'string' &&
    (body.requiredAuth === 'user' || body.requiredAuth === 'admin')
  ) {
    return false;
  }

  const code = normalizeErrorCode(body.error || body.code);
  const nestedCode = normalizeErrorCode(body.code);
  if (AUTH_REQUIRED_EXCLUSIONS.has(code) || AUTH_REQUIRED_EXCLUSIONS.has(nestedCode)) {
    return false;
  }

  if (
    body.requiresLogin === true ||
    body.need_auth === true ||
    body.agentInitRequired === true
  ) {
    return true;
  }

  if (isSessionExpiredApiError(body)) return true;

  if (AUTH_REQUIRED_CODES.has(code)) return true;

  if (code === 'invalid_token') {
    const desc = String(body.error_description || body.message || '').toLowerCase();
    return (
      desc.includes('expired') ||
      desc.includes('jwt expired') ||
      desc.includes('no longer valid') ||
      desc.includes('sign in') ||
      desc.includes('log in')
    );
  }

  const desc = String(body.error_description || body.message || '').toLowerCase();
  return (
    desc.includes('jwt expired') ||
    desc.includes('session has expired') ||
    desc.includes('session expired') ||
    desc.includes('please log in') ||
    desc.includes('please sign in') ||
    desc.includes('sign in again')
  );
}

/**
 * Normalize a 401 API failure into a stable shape for agent/UI callers.
 * @param {number} status
 * @param {unknown} [body]
 * @returns {{ need_auth: true, requiresLogin: true, error: string, message: string, _status: number, code: string }}
 */
export function normalizeAuthFailure(status, body) {
  const raw = body && typeof body === 'object' ? body : {};
  const message =
    (typeof raw.message === 'string' && raw.message.trim()) ||
    (typeof raw.error_description === 'string' && raw.error_description.trim()) ||
    DEFAULT_SESSION_EXPIRED_MESSAGE;
  return {
    ...raw,
    need_auth: true,
    requiresLogin: true,
    error: 'session_expired',
    code: 'session_expired',
    message,
    _status: status === 401 ? 401 : status || 401,
  };
}

/**
 * Infer admin vs customer re-auth CTA from the current path.
 * @param {string} [pathname]
 * @returns {'admin' | 'customer'}
 */
function sessionReauthRoleForPath(pathname) {
  const p = (pathname || '').replace(/\/$/, '') || '/';
  return p === '/admin' || p.startsWith('/admin/') ? 'admin' : 'customer';
}

/**
 * True once the user has actually interacted with this page.
 *
 * A 401 nobody asked for — a page-load fetch, a background poll, the global
 * fetch wrapper in apiTrafficStore — must not throw a modal in front of a
 * visitor who has done nothing yet. `navigator.userActivation.hasBeenActive`
 * is the browser's own answer to "has the user touched this page", so no
 * listener or module state is needed. Sticky (not the 5s transient window) on
 * purpose: a prompt submit that 401s 30s later still counts as user-driven.
 *
 * Undefined (jsdom, older Firefox) → true, i.e. the previous behaviour.
 * @returns {boolean}
 */
function userHasInteracted() {
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
  return ua ? ua.hasBeenActive === true : true;
}

/**
 * Show the global SessionReauthBanner when an API call proves auth is required again.
 * Clears cached oauth status and stale React user state via `invalidateSession` on the event.
 * @param {{ status?: number, body?: unknown, pathname?: string }} [opts]
 */
export function notifySessionExpiredIfNeeded(opts = {}) {
  if (typeof window === 'undefined') return;
  const { status, body, pathname = window.location?.pathname } = opts;
  if (!isAuthRequiredApiError(status, body)) return;
  if (!isAuthenticatedAppSurface(pathname)) return;
  if (!userHasInteracted()) return;

  const now = Date.now();
  if (now - lastSessionExpiryNotifyAt < SESSION_EXPIRY_NOTIFY_MS) return;
  lastSessionExpiryNotifyAt = now;

  clearStatusCache();

  // The first field with real CONTENT, not merely the first field present.
  // Two bugs this replaces, both of which emptied the "What the server said"
  // disclosure while the server had in fact said something:
  //   - `error` was never consulted, so the many endpoints that return a bare
  //     { error: 'authentication_required' } (pathInfo, mcpDecisionPolling,
  //     resourceServer) produced no detail at all.
  //   - an empty error_description won the old ternary outright and suppressed
  //     a populated `message` alongside it, because the branch was chosen on the
  //     field being a string rather than on it being non-empty.
  const desc =
    [body?.error_description, body?.message, body?.error]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find(Boolean) || '';

  window.dispatchEvent(
    new CustomEvent(SESSION_REAUTH_EVENT, {
      detail: {
        message: interruptMessageForAuthFailure(body),
        // Raw provider text kept, but demoted: SignInModal shows it behind a
        // disclosure instead of leading with "jwt expired".
        detail: desc || undefined,
        role: sessionReauthRoleForPath(pathname),
        invalidateSession: true,
      },
    }),
  );
}

/**
 * True when an inline error message is asking the user to authenticate again.
 * @param {unknown} message
 * @returns {boolean}
 */
export function errorMessageSuggestsLogin(message) {
  if (message == null || typeof message !== 'string') return false;
  const m = message.toLowerCase();
  return (
    m.includes('please log in') ||
    m.includes('log in again') ||
    m.includes('sign in again') ||
    m.includes('session has expired')
  );
}

/** Dispatched by navigateToCustomerOAuthLogin; PiFlowSignInModal sets `detail.handled = true`. */
export const PI_FLOW_SIGNIN_EVENT = 'banking-pi-flow-signin';

/**
 * Redirect to customer (end-user) OAuth Backend-for-Frontend (BFF) route.
 * @param {string} [returnTo] - app path to land on after login (BFF `return_to`).
 *   If not provided, defaults to current page unless on landing page (redirects to /dashboard).
 */
export function navigateToCustomerOAuthLogin(returnTo) {
  openSignIn({ role: 'customer', returnTo });
}

// Redirect-only leg (no modal event). signInService's openSignIn falls back to
// these when the BFF reports pi.flow unavailable; pages bypassing the service
// must not import them directly.
export function navigateToCustomerOAuthLoginRaw(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  let destination = returnTo;
  if (!destination && typeof window !== 'undefined') {
    const currentPath = window.location.pathname;
    destination = currentPath === '/' ? '/dashboard' : currentPath;
  }

  const suffix = destination ? `?return_to=${encodeURIComponent(destination)}` : '';
  navigateWithOverlay(`${apiUrl}/api/auth/oauth/user/login${suffix}`, { message: 'Signing in...' });
}

/**
 * Force re-authentication — clears existing session and sends prompt=login to PingOne.
 * @param {string} [returnTo] - app path to land on after login (BFF `return_to`).
 *   Same defaulting as navigateToCustomerOAuthLogin. Without it the user signs
 *   back in and lands somewhere other than the page they were interrupted on,
 *   which is what made a session expiry lose your place mid-task.
 */
export function navigateToCustomerOAuthForceLogin(returnTo) {
  openSignIn({ role: 'customer', returnTo, force: true });
}

export function navigateToCustomerOAuthForceLoginRaw(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  let destination = returnTo;
  if (!destination && typeof window !== 'undefined') {
    const currentPath = window.location.pathname;
    destination = currentPath === '/' ? '/dashboard' : currentPath;
  }

  // force=true is already in the query, so return_to joins with &.
  const suffix = destination ? `&return_to=${encodeURIComponent(destination)}` : '';
  navigateWithOverlay(`${apiUrl}/api/auth/oauth/user/login?force=true${suffix}`, { message: 'Signing in...' });
}

/**
 * Redirect to admin OAuth Backend-for-Frontend (BFF) route.
 * @param {string} [returnTo] - app path to land on after login (BFF `return_to`).
 */
export function navigateToAdminOAuthLogin(returnTo) {
  openSignIn({ role: 'admin', returnTo });
}

export function navigateToAdminOAuthLoginRaw(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  let destination = returnTo;
  if (!destination && typeof window !== 'undefined') {
    const currentPath = window.location.pathname;
    destination = currentPath === '/' ? '/dashboard' : currentPath;
  }

  const suffix = destination ? `?return_to=${encodeURIComponent(destination)}` : '';
  navigateWithOverlay(`${apiUrl}/api/auth/oauth/login${suffix}`, { message: 'Signing in...' });
}

/**
 * Silent re-authentication — mint a FRESH access token with the current scopes /
 * claims, without a credential prompt. Use after an action that changes what the
 * token must carry (vertical switch → new featureScope; delegation → may_act),
 * where a refresh-token renewal is insufficient. The BFF `/api/auth/reauth` clears
 * the stored token and 302s to the role-appropriate login (no prompt=login), so
 * PingOne SSO re-issues silently and returns the user to `returnTo`.
 * @param {string} [returnTo] path to land on after re-auth; defaults to current path.
 */
export function requestSilentReauth(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  const rt =
    returnTo || (typeof window !== 'undefined' ? window.location.pathname : '/dashboard');
  navigateWithOverlay(`${apiUrl}/api/auth/reauth?return_to=${encodeURIComponent(rt)}`, {
    message: 'Refreshing your session...',
  });
}
