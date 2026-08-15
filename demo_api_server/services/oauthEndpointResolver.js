'use strict';
const configStore = require('./configStore');

/**
 * Resolves OAuth endpoints using priority:
 * 1. Explicit configStore value (supports any IDP via OAUTH_* env vars or Config UI)
 * 2. OIDC discovery cache (populated at startup when oauth_discovery_enabled=true)
 * 3. PingOne pattern computed from environment_id + region
 * 4. Empty string (not configured)
 */

// Module-level sync cache populated by initializeDiscovery()
let _discoveryCache = null;

function _pingOneBase() {
  const region = configStore.getEffective('pingone_region') || 'com';
  const envId  = configStore.getEffective('pingone_environment_id');
  if (!envId) return '';
  return `https://auth.pingone.${region}/${envId}/as`;
}

function _fromCache(field) {
  return _discoveryCache?.[field] ?? null;
}

function getAuthorizationEndpoint() {
  const explicit = configStore.getEffective('oauth_authorization_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('authorization_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/authorize` : '';
}

function getTokenEndpoint() {
  const explicit = configStore.getEffective('oauth_token_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('token_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/token` : '';
}

/** RFC 9126 PAR endpoint — same priority chain as getTokenEndpoint. */
function getParEndpoint() {
  const explicit = configStore.getEffective('oauth_par_endpoint')
    || configStore.getEffective('pingone_par_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('pushed_authorization_request_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/par` : '';
}

function getUserInfoEndpoint() {
  const explicit = configStore.getEffective('oauth_userinfo_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('userinfo_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/userinfo` : '';
}

function getJwksUri() {
  const explicit = configStore.getEffective('oauth_jwks_uri');
  if (explicit) return explicit;
  const cached = _fromCache('jwks_uri');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/jwks` : '';
}

function getIntrospectionEndpoint() {
  const explicit = configStore.getEffective('oauth_introspection_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('introspection_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/introspect` : '';
}

function getRevocationEndpoint() {
  const explicit = configStore.getEffective('oauth_revocation_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('revocation_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/revoke` : '';
}

// PingOne issues tokens with iss = https://auth.pingone.{tld}/{envId}/as.
// A misconfigured OAUTH_ISSUER missing the /as suffix makes every token fail
// validation ("jwt issuer invalid") and silently breaks all authenticated
// requests. Auto-correct PingOne issuers here (the single chokepoint feeding
// the token validator) so the omission can't recur. Scoped to the PingOne auth
// domain by regex — non-PingOne IdPs (Okta, Auth0, PingFederate) use different
// issuer shapes and are left untouched.
const _PINGONE_ISSUER_NO_AS = /^https:\/\/auth\.pingone\.[a-z.]+\/[^/]+$/;
let _warnedIssuerSuffix = false;
function _normalizePingOneIssuer(issuer) {
  if (typeof issuer !== 'string') return issuer;
  const trimmed = issuer.replace(/\/+$/, '');
  if (_PINGONE_ISSUER_NO_AS.test(trimmed)) {
    const fixed = `${trimmed}/as`;
    if (!_warnedIssuerSuffix) {
      _warnedIssuerSuffix = true;
      console.warn(
        `[oauthEndpointResolver] OAUTH_ISSUER "${issuer}" is missing the PingOne "/as" suffix; ` +
        `using "${fixed}". Fix OAUTH_ISSUER in .env to silence this warning.`
      );
    }
    return fixed;
  }
  return issuer;
}

function getIssuer() {
  const explicit = configStore.getEffective('oauth_issuer');
  if (explicit) return _normalizePingOneIssuer(explicit);
  const cached = _fromCache('issuer');
  if (cached) return _normalizePingOneIssuer(cached);
  return _pingOneBase();
}

function getDiscoveryEndpoint() {
  const explicit = configStore.getEffective('oauth_discovery_endpoint');
  if (explicit) return explicit;
  const region = configStore.getEffective('pingone_region') || 'com';
  const envId  = configStore.getEffective('pingone_environment_id');
  if (envId) {
    return `https://auth.pingone.${region}/${envId}/as/.well-known/openid-configuration`;
  }
  // Standard OIDC / RFC 8414 fallback: derive discovery from the configured
  // issuer (non-PingOne IdPs, e.g. PingFederate). Without this, OAUTH_ISSUER
  // alone could never drive discovery.
  const issuer = configStore.getEffective('oauth_issuer');
  if (issuer) {
    return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  }
  return '';
}

function getOAuthEndpoints() {
  return {
    authorization_endpoint:  getAuthorizationEndpoint(),
    token_endpoint:          getTokenEndpoint(),
    userinfo_endpoint:       getUserInfoEndpoint(),
    jwks_uri:                getJwksUri(),
    introspection_endpoint:  getIntrospectionEndpoint(),
    revocation_endpoint:     getRevocationEndpoint(),
    issuer:                  getIssuer(),
    discovery_endpoint:      getDiscoveryEndpoint(),
  };
}

/**
 * Async startup initializer — fetches OIDC discovery metadata and populates
 * the module-level cache. Called once at server startup; never blocks sync getters.
 * No-ops when oauth_discovery_enabled != 'true'.
 */
async function initializeDiscovery() {
  const enabled = configStore.getEffective('oauth_discovery_enabled');
  if (enabled !== 'true') return;

  try {
    const { fetchDiscoveryMetadata, extractEndpoints, persistDiscoveredEndpoints } = require('./oauthDiscoveryService');
    const discoveryUrl = getDiscoveryEndpoint();
    if (!discoveryUrl) return;

    console.log(`[oauth-resolver] Fetching OIDC discovery from ${discoveryUrl}`);
    const metadata = await fetchDiscoveryMetadata(discoveryUrl);
    if (!metadata) {
      console.warn('[oauth-resolver] Discovery returned no metadata — using fallback resolution');
      return;
    }

    _discoveryCache = extractEndpoints(metadata);
    persistDiscoveredEndpoints(_discoveryCache);
    console.log('[oauth-resolver] OIDC discovery cache populated and persisted to LMDB');
  } catch (err) {
    console.warn('[oauth-resolver] Discovery initialization failed:', err.message);
  }
}

/** Clears the discovery cache (used in tests). */
function _resetDiscoveryCache() {
  _discoveryCache = null;
}

module.exports = {
  getAuthorizationEndpoint,
  getTokenEndpoint,
  getParEndpoint,
  getUserInfoEndpoint,
  getJwksUri,
  getIntrospectionEndpoint,
  getRevocationEndpoint,
  getIssuer,
  getDiscoveryEndpoint,
  getOAuthEndpoints,
  initializeDiscovery,
  _resetDiscoveryCache,
};
