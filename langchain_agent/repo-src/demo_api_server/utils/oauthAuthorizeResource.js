// banking_api_server/utils/oauthAuthorizeResource.js
/**
 * PingOne returns invalid_scope ("May not request scopes for multiple resources") when the
 * authorize request includes RFC 8707 `resource` together with scopes that span more than one
 * resource — notably standard OIDC scopes plus custom API scopes (e.g. *).
 *
 * ENDUSER_AUDIENCE is still used after token issuance (see middleware/auth.js); omit `resource`
 * on /authorize only when the scope list mixes OIDC and custom API scopes.
 */

// Only `openid` triggers PingOne's "May not request scopes for multiple resources" error
// when combined with a custom resource= audience. profile, email, and offline_access
// do not constitute a separate resource server in PingOne's enforcement model.
const OIDC_SCOPE_NAMES = new Set(['openid']);

/**
 * @param {string|null|undefined} resourceAudience
 * @param {string[]} scopes
 * @returns {string}  '' or '&resource=...' for appending to the authorize URL
 */
function buildPingOneAuthorizeResourceQueryParam(resourceAudience, scopes) {
  const aud = resourceAudience != null ? String(resourceAudience).trim() : '';
  if (!aud) return '';

  const list = Array.isArray(scopes) ? scopes : [];

  const hasOidc = list.some((s) => OIDC_SCOPE_NAMES.has(s));
  const hasCustomApi = list.some(
    (s) => typeof s === 'string' && (s.startsWith('') || s === 'ai_agent'),
  );

  if (hasOidc && hasCustomApi) return '';

  return `&resource=${encodeURIComponent(aud)}`;
}

module.exports = {
  buildPingOneAuthorizeResourceQueryParam,
  OIDC_SCOPE_NAMES,
};
