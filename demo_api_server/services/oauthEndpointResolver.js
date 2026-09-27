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

function _isPingFederate(provider) {
  if (provider !== undefined) return provider === 'pingfederate';
  return typeof configStore.getOAuthProvider === 'function'
    && configStore.getOAuthProvider() === 'pingfederate';
}

function _configured(key, fallbackKey) {
  return configStore.getEffective(key) || (fallbackKey ? configStore.getEffective(fallbackKey) : '');
}

function getAuthorizationEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_authorization_endpoint', 'oauth_authorization_endpoint')
      || _fromCache('authorization_endpoint')
      || '';
  }
  const explicit = configStore.getEffective('oauth_authorization_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('authorization_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/authorize` : '';
}

function getTokenEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_token_endpoint', 'oauth_token_endpoint')
      || _fromCache('token_endpoint')
      || '';
  }
  const explicit = configStore.getEffective('oauth_token_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('token_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/token` : '';
}

/**
 * Resolve PingOne's token endpoint independently of the active user-login IdP.
 * Machine clients configured with PingOne credentials must never send them to
 * the shared PF endpoint when OAUTH_PROVIDER=pingfederate.
 */
function getPingOneTokenEndpoint() {
  const explicit = String(process.env.PINGONE_TOKEN_ENDPOINT || '').trim();
  if (explicit) return explicit;
  const base = _pingOneBase();
  return base ? `${base}/token` : '';
}

/**
 * Resolve PingOne's issuer independently of the active interactive-login IdP.
 * MCP machine tokens can still be PingOne-issued when browser login uses PF.
 */
function getPingOneIssuer() {
  const explicit = String(process.env.PINGONE_ISSUER_URI || process.env.PINGONE_ISSUER || '').trim();
  if (explicit) return _normalizePingOneIssuer(explicit.replace(/\/+$/, ''));

  const tokenEndpoint = getPingOneTokenEndpoint();
  if (tokenEndpoint) {
    try {
      const endpoint = new URL(tokenEndpoint);
      const path = endpoint.pathname.replace(/\/+$/, '');
      if (path.endsWith('/token')) {
        return `${endpoint.origin}${path.slice(0, -'/token'.length)}`;
      }
    } catch {
      // Fall through to the environment-derived PingOne base when the override
      // is not a valid URL.
    }
  }

  return _pingOneBase();
}

/** Resolve the JWKS endpoint for PingOne-issued tokens, regardless of login IdP. */
function getPingOneJwksUri() {
  const explicit = String(process.env.PINGONE_JWKS_URI || process.env.PINGONE_JWKS_ENDPOINT || '').trim();
  if (explicit) return explicit;
  const issuer = getPingOneIssuer();
  return issuer ? `${issuer.replace(/\/+$/, '')}/jwks` : '';
}

/** RFC 9126 PAR endpoint — same priority chain as getTokenEndpoint. */
function getParEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_par_endpoint', 'oauth_par_endpoint')
      || _fromCache('pushed_authorization_request_endpoint')
      || '';
  }
  const explicit = configStore.getEffective('oauth_par_endpoint')
    || configStore.getEffective('pingone_par_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('pushed_authorization_request_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/par` : '';
}

function getUserInfoEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_userinfo_endpoint', 'oauth_userinfo_endpoint')
      || _fromCache('userinfo_endpoint')
      || '';
  }
  const explicit = configStore.getEffective('oauth_userinfo_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('userinfo_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/userinfo` : '';
}

function getJwksUri() {
  if (_isPingFederate()) {
    return _configured('pf_jwks_uri', 'oauth_jwks_uri')
      || _fromCache('jwks_uri')
      || '';
  }
  const explicit = configStore.getEffective('oauth_jwks_uri');
  if (explicit) return explicit;
  const cached = _fromCache('jwks_uri');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/jwks` : '';
}

function getIntrospectionEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_introspection_endpoint', 'oauth_introspection_endpoint')
      || _fromCache('introspection_endpoint')
      || '';
  }
  const explicit = configStore.getEffective('oauth_introspection_endpoint');
  if (explicit) return explicit;
  const cached = _fromCache('introspection_endpoint');
  if (cached) return cached;
  const base = _pingOneBase();
  return base ? `${base}/introspect` : '';
}

function getEndSessionEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_end_session_endpoint')
      || _fromCache('end_session_endpoint')
      || `${getIssuer().replace(/\/+$/, '')}/idp/init_logout.openid`;
  }
  return '';
}

function getRevocationEndpoint() {
  if (_isPingFederate()) {
    return _configured('pf_revocation_endpoint', 'oauth_revocation_endpoint')
      || _fromCache('revocation_endpoint')
      || `${getIssuer().replace(/\/+$/, '')}/as/revoke_token.oauth2`;
  }
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

function getIssuer(provider) {
  if (_isPingFederate(provider)) {
    return _configured('pf_issuer', 'oauth_issuer')
      || (provider === undefined ? _fromCache('issuer') : null)
      || '';
  }
  const explicit = configStore.getEffective('oauth_issuer');
  if (explicit) return _normalizePingOneIssuer(explicit);
  const cached = _fromCache('issuer');
  if (cached) return _normalizePingOneIssuer(cached);
  return _pingOneBase();
}

function getDiscoveryEndpoint(provider) {
  if (_isPingFederate(provider)) {
    // An explicit provider override is used by PF preflight even while
    // PingOne is globally selected. Shared OAUTH_* values may belong to
    // PingOne, so only trust PF-specific settings in that case.
    const explicit = provider === undefined
      ? _configured('pf_discovery_endpoint', 'oauth_discovery_endpoint')
      : configStore.getEffective('pf_discovery_endpoint');
    if (explicit) return explicit;
    const cached = provider === undefined ? _fromCache('discovery_endpoint') : null;
    if (cached) return cached;
    const issuer = provider === undefined
      ? getIssuer()
      : configStore.getEffective('pf_issuer');
    return issuer ? `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration` : '';
  }
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
  getPingOneTokenEndpoint,
  getPingOneIssuer,
  getPingOneJwksUri,
  getParEndpoint,
  getUserInfoEndpoint,
  getJwksUri,
  getIntrospectionEndpoint,
  getRevocationEndpoint,
  getEndSessionEndpoint,
  getIssuer,
  getDiscoveryEndpoint,
  getOAuthEndpoints,
  initializeDiscovery,
  _resetDiscoveryCache,
};
