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
function buildPingOneSignoffUrl(postLogoutUri, clientIdKey, idToken) {
  const envId = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const clientId = configStore.getEffective(clientIdKey);
  const params = new URLSearchParams({ post_logout_redirect_uri: postLogoutUri });
  if (idToken) params.set('id_token_hint', idToken);
  if (clientId) params.set('client_id', clientId);
  return `https://auth.pingone.${region}/${envId}/as/signoff?${params.toString()}`;
}

module.exports = { clearAllAuthCookies, buildPingOneSignoffUrl };
