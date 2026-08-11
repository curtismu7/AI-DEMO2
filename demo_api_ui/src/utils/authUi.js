// banking_api_ui/src/utils/authUi.js
/** Shared helpers for re-auth CTAs when the UI shows session/login errors. */

import { clearStatusCache } from '../services/cachedStatusService';

/** Dispatched with `detail: { message, role: 'admin' | 'customer' }` so `App` can show an on-page banner. */
export const SESSION_REAUTH_EVENT = 'banking-session-reauth';

/** Canonical user-facing copy for session/auth loss (banner + agent chat). */
export const USER_SESSION_EXPIRED_MESSAGE =
  'For a more personalized experience, please sign in.';

const DEFAULT_SESSION_EXPIRED_MESSAGE = USER_SESSION_EXPIRED_MESSAGE;

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
 * Exclude-only: public landing, logout, and setup — every other app path qualifies
 * (embedded agent hosts, use-case pages, etc.).
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isAuthenticatedAppSurface(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/' || p === '/logout' || p.startsWith('/setup')) return false;
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
export function sessionReauthRoleForPath(pathname) {
  const p = (pathname || '').replace(/\/$/, '') || '/';
  return p === '/admin' || p.startsWith('/admin/') ? 'admin' : 'customer';
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

  const now = Date.now();
  if (now - lastSessionExpiryNotifyAt < SESSION_EXPIRY_NOTIFY_MS) return;
  lastSessionExpiryNotifyAt = now;

  clearStatusCache();

  const desc =
    typeof body?.error_description === 'string'
      ? body.error_description.trim()
      : typeof body?.message === 'string'
        ? body.message.trim()
        : '';
  const message =
    desc && /expired|invalid|sign in|log in/i.test(desc)
      ? /sign in again|log in again/i.test(desc)
        ? desc
        : `${desc} Sign in again to continue.`
      : DEFAULT_SESSION_EXPIRED_MESSAGE;

  window.dispatchEvent(
    new CustomEvent(SESSION_REAUTH_EVENT, {
      detail: {
        message,
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

/**
 * Redirect to customer (end-user) OAuth Backend-for-Frontend (BFF) route.
 * @param {string} [returnTo] - app path to land on after login (BFF `return_to`)
 */
export function navigateToCustomerOAuthLogin(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  const suffix = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
  window.location.href = `${apiUrl}/api/auth/oauth/user/login${suffix}`;
}

/** Force re-authentication — clears existing session and sends prompt=login to PingOne. */
export function navigateToCustomerOAuthForceLogin() {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  window.location.href = `${apiUrl}/api/auth/oauth/user/login?force=true`;
}

/** Redirect to admin OAuth Backend-for-Frontend (BFF) route. */
export function navigateToAdminOAuthLogin() {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  window.location.href = `${apiUrl}/api/auth/oauth/login`;
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
  window.location.href = `${apiUrl}/api/auth/reauth?return_to=${encodeURIComponent(rt)}`;
}
