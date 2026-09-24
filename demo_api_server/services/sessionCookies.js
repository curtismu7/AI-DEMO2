'use strict';

/**
 * sessionCookies.js
 *
 * Single source of truth for clearing every browser-held auth cookie on logout
 * or session reset. The logout flow lives in three places (admin logout,
 * user logout, and the unified /api/auth/logout + /api/auth/clear-session in
 * server.js); each one must expire the exact same set of cookies or the
 * browser keeps stale session state. Centralising it here keeps the cookie
 * flags consistent.
 *
 * Cookies cleared:
 *   _auth          – auth-state cookie (HMAC-signed identity, see authStateCookie.js)
 *   _pkce          – PKCE state cookie (see pkceStateCookie.js)
 *   connect.sid    – express-session cookie
 *   _switch_target – role-switch target hint (see server.js /api/auth/switch)
 */

const { clearAuthCookie } = require('./authStateCookie');
const { clearPkceCookie } = require('./pkceStateCookie');
const configStore = require('./configStore');

/**
 * Expire all auth-related cookies so the browser holds no session state.
 * session.destroy() only removes server-side data — the browser retains
 * cookie values until they are overwritten with Max-Age=0.
 *
 * @param {object} res - Express response
 * @param {boolean} isProduction - controls Secure / SameSite flags
 */
function clearAllAuthCookies(res, isProduction) {
  clearAuthCookie(res, isProduction);
  clearPkceCookie(res, isProduction);

  const sameSite = isProduction ? 'none' : 'lax';
  res.clearCookie('connect.sid', { httpOnly: true, secure: isProduction, sameSite, path: '/' });
  res.clearCookie('_switch_target', { secure: isProduction, sameSite, path: '/' });
}

/**
 * Build the PingOne RP-Initiated Logout redirect URL.
 * Both admin and user logout routes use this — the only difference is which
 * client ID key to look up.
 *
 * @param {string} postLogoutUri - where PingOne should redirect after signoff
 * @param {string} clientIdKey - configStore key for the client_id (e.g. 'pingone_admin_client_id')
 * @param {string|null} idToken - id_token_hint value (may be null)
 * @returns {string} full signoff redirect URL
 */
function buildPingOneSignoffUrl(postLogoutUri, clientIdKey, idToken, provider = configStore.getOAuthProvider?.()) {
  const params = new URLSearchParams({ post_logout_redirect_uri: postLogoutUri });
  if (idToken) params.set('id_token_hint', idToken);

  // PingFederate mode: terminate the PF SSO session at PF's OIDC end-session
  // endpoint with the PF user client. Redirecting to PingOne's signoff instead
  // leaves the PF session alive, so the next /login silently re-authenticates
  // as the previous user — logout appeared to do nothing.
  if (provider === 'pingfederate') {
    const endpointResolver = require('./oauthEndpointResolver');
    const currentProvider = configStore.getOAuthProvider?.();
    const pfIssuer = configStore.getEffective('pf_issuer') || '';
    const endSession = currentProvider === 'pingfederate'
      ? endpointResolver.getEndSessionEndpoint?.()
      : (configStore.getEffective('pf_end_session_endpoint')
        || (pfIssuer ? `${pfIssuer.replace(/\/+$/, '')}/idp/init_logout.openid` : ''));
    const clientId = configStore.getEffective('pf_user_client_id');
    if (clientId) params.set('client_id', clientId);
    return endSession ? `${endSession}?${params.toString()}` : postLogoutUri;
  }

  const envId = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const clientId = configStore.getEffective(clientIdKey)
    || (clientIdKey === 'pingone_admin_client_id'
      ? (process.env.PINGONE_ADMIN_CLIENT_ID || process.env.PINGONE_CLIENT_ID)
      : process.env.PINGONE_USER_CLIENT_ID);
  if (clientId) params.set('client_id', clientId);
  return `https://auth.pingone.${region}/${envId}/as/signoff?${params.toString()}`;
}

module.exports = { clearAllAuthCookies, buildPingOneSignoffUrl };
