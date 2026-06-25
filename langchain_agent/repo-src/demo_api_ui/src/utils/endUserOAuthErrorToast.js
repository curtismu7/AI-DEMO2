// banking_api_ui/src/utils/endUserOAuthErrorToast.js
/** Toast + URL cleanup for end-user OAuth failures redirected from BFF (avoids /login where FAB is hidden). */

import { notifyError } from './appToast';

/**
 * If URL carries BFF OAuth error query params, show a toast and return true.
 * @param {URLSearchParams} searchParams
 * @returns {boolean}
 */
export function showEndUserOAuthErrorToast(searchParams) {
  const errorParam = searchParams.get('error');
  if (!errorParam) return false;

  const idpError = (searchParams.get('idp_error') || '').trim();
  const desc = (searchParams.get('error_description') || '').trim();
  const detail = (searchParams.get('detail') || '').trim();
  const info = (searchParams.get('info') || '').trim();

  let errorMessage = '';

  switch (errorParam) {
    case 'oauth_provider':
      if (idpError === 'unsupported_response_type' || /unsupported_response_type/i.test(desc)) {
        errorMessage =
          'PingOne rejected the authorize request (often **pi.flow** is not enabled on this app). '
          + 'In **Demo config** or **Application setup**, set **Customer login mode** to **Redirect** (standard code + PKCE), '
          + 'or enable pi.flow on the PingOne OIDC application.';
      } else if (idpError === 'access_denied' || /access_denied/i.test(desc)) {
        errorMessage = 'Sign-in was cancelled or denied at PingOne.';
      } else if (idpError === 'invalid_scope' && /may not request scopes for multiple resource/i.test(desc)) {
        errorMessage =
          'PingOne rejected the login: banking scopes are on a separate **Resource Server**, so mixing them with ' +
          'OIDC scopes in one request is blocked. Fix: in **Demo config**, enable ' +
          '**"Login — OIDC-only authorize"** (`ff_oidc_only_authorize`). ' +
          'Pair with **"Skip Token Exchange"** if token exchange is also not configured.';
      } else if (idpError) {
        errorMessage = `PingOne returned: ${idpError}. ${desc ? String(desc).slice(0, 220) : 'Try again or use standard redirect sign-in (Demo config → Customer login mode).'}`.trim();
      } else {
        errorMessage =
          desc
            ? `Sign-in failed: ${String(desc).slice(0, 280)}`
            : 'OAuth authentication failed at PingOne. Try again.';
      }
      break;
    case 'oauth_error':
      errorMessage = 'OAuth authentication failed. Please try again.';
      break;
    case 'invalid_state':
      errorMessage = 'Invalid authentication state (try closing extra tabs or signing in again).';
      break;
    case 'no_code':
      errorMessage =
        'No authorization code returned — if you use **pi.flow**, ensure the PingOne app supports it; '
        + 'otherwise set **Customer login mode** to **Redirect** in Demo config.';
      break;
    case 'nonce_mismatch':
      errorMessage = 'Sign-in security check failed. Please try signing in again.';
      break;
    case 'callback_failed':
      if (detail === 'invalid_client') {
        errorMessage = 'Sign-in failed due to a configuration issue. Please contact your administrator.';
      } else if (detail === 'invalid_grant') {
        errorMessage = 'Your sign-in session expired. Please try again.';
      } else if (detail === 'access_denied') {
        errorMessage = 'Access was denied. Please contact your administrator if this is unexpected.';
      } else {
        errorMessage = info
          ? `Sign-in could not be completed: ${String(info).slice(0, 240)}`
          : 'Sign-in could not be completed. Please try again.';
      }
      break;
    case 'too_many_requests':
      errorMessage = 'Too many sign-in attempts. Please wait a few minutes and try again.';
      break;
    case 'oauth_init_failed':
      errorMessage = 'Sign-in is temporarily unavailable. Please try again.';
      break;
    case 'session_regenerate_failed':
    case 'session_persist_failed':
      errorMessage =
        errorParam === 'session_persist_failed'
          ? 'PingOne sign-in succeeded, but the app could not save your session (check Upstash / KV on Vercel).'
          : 'Could not finalize your session. Please try signing in again.';
      break;
    default:
      errorMessage = 'Something went wrong during sign-in. Please try again.';
  }

  notifyError(errorMessage, { autoClose: 10000 });
  return true;
}

/** Remove OAuth error params so refresh does not re-toast. */
export function stripEndUserOAuthErrorParamsFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const keys = ['error', 'error_description', 'idp_error', 'detail', 'info'];
  let changed = false;
  for (const k of keys) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  if (changed) {
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', next);
  }
}
