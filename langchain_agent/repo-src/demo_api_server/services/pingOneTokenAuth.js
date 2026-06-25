/**
 * pingOneTokenAuth.js
 *
 * Shared helpers for minting PingOne client_credentials tokens robustly.
 *
 * Why: the worker/management token's client-authentication method is configurable
 * (`pingone_mgmt_token_auth_method`: basic | post | client_secret_jwt | private_key_jwt).
 * A stale /config (LMDB) value — e.g. `post` — that doesn't match the app's actual
 * tokenEndpointAuthMethod (worker apps default to `client_secret_basic`) makes PingOne
 * reject every token request with `invalid_client`, wedging may_act hardening, delegation
 * emails, and admin lookups. PingOne is the source of truth for which method the app
 * accepts, not our config — so for the symmetric secret methods (basic ↔ post) we try the
 * configured one first and fall back to the alternate on an auth-method rejection.
 */
'use strict';

/** Order of client-secret auth methods to attempt. JWT/none are explicit — no fallback. */
function authMethodOrder(configured) {
  const m = String(configured || 'basic').toLowerCase();
  if (m === 'post') return ['post', 'basic'];
  if (m === 'basic') return ['basic', 'post'];
  return [m]; // client_secret_jwt / private_key_jwt / none — caller-specified, no guessing
}

/** True when the error is PingOne rejecting client authentication (wrong method/secret). */
function isInvalidClientError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data || {};
  const blob = `${data.error || ''} ${data.error_description || err?.message || ''}`;
  return (status === 400 || status === 401) && /invalid_client/i.test(blob);
}

module.exports = { authMethodOrder, isInvalidClientError };
