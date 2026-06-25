// banking_api_ui/src/utils/authUi.js
/** Shared helpers for re-auth CTAs when the UI shows session/login errors. */

import { clearStatusCache } from '../services/cachedStatusService';

/** Dispatched with `detail: { message, role: 'admin' | 'customer' }` so `App` can show an on-page banner. */
export const SESSION_REAUTH_EVENT = 'banking-session-reauth';

const DEFAULT_SESSION_EXPIRED_MESSAGE =
  'Your sign-in session has expired. Sign in again to continue.';

/** Throttle duplicate banners when several API calls 401 at once. */
let lastSessionExpiryNotifyAt = 0;
const SESSION_EXPIRY_NOTIFY_MS = 8000;

/**
 * Routes where a 401 with an expired JWT should surface the re-auth banner
 * (not on public landing/login surfaces).
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isAuthenticatedAppSurface(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/' || p === '/logout' || p.startsWith('/setup')) return false;
  return (
    p === '/dashboard' ||
    p.startsWith('/admin') ||
    p === '/config' ||
    p.startsWith('/configure') ||
    p.startsWith('/monitoring') ||
    p === '/api-traffic' ||
    p === '/mcp-traffic' ||
    p === '/onboarding' ||
    p === '/self-service' ||
    p === '/pingone-test' ||
    p === '/mfa-test' ||
    p === '/authz-test' ||
    p === '/resource-server' ||
    p === '/resource-server-cc' ||
    p.startsWith('/agent-flow-inspector')
  );
}

/**
 * True when a BFF 401 JSON body indicates the PingOne access token is no longer valid.
 * @param {unknown} body
 * @returns {boolean}
 */
export function isSessionExpiredApiError(body) {
  if (!body || typeof body !== 'object') return false;
  const err = String(body.error || '').toLowerCase();
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
 * Infer admin vs customer re-auth CTA from the current path.
 * @param {string} [pathname]
 * @returns {'admin' | 'customer'}
 */
export function sessionReauthRoleForPath(pathname) {
  const p = (pathname || '').replace(/\/$/, '') || '/';
  return p === '/admin' || p.startsWith('/admin/') ? 'admin' : 'customer';
}

/**
 * Show the global SessionReauthBanner when an API call proves the session JWT expired.
 * Clears cached oauth status and stale React user state via `invalidateSession` on the event.
 * @param {{ status?: number, body?: unknown, pathname?: string }} [opts]
 */
export function notifySessionExpiredIfNeeded(opts = {}) {
  if (typeof window === 'undefined') return;
  const { status, body, pathname = window.location?.pathname } = opts;
  if (status !== 401 || !isSessionExpiredApiError(body)) return;
  if (!isAuthenticatedAppSurface(pathname)) return;

  const now = Date.now();
  if (now - lastSessionExpiryNotifyAt < SESSION_EXPIRY_NOTIFY_MS) return;
  lastSessionExpiryNotifyAt = now;

  clearStatusCache();

  const desc =
    typeof body?.error_description === 'string' ? body.error_description.trim() : '';
  const message =
    desc && /expired|invalid|sign in/i.test(desc)
      ? `${desc} Sign in again to continue.`
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

/** Redirect to customer (end-user) OAuth Backend-for-Frontend (BFF) route. */
export function navigateToCustomerOAuthLogin() {
  const apiUrl =
    process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  window.location.href = `${apiUrl}/api/auth/oauth/user/login`;
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
