'use strict';

const configStore = require('./configStore');
const { getFrontendOrigin } = require('./oauthRedirectUris');

const CIMD_CALLBACK_PATH = '/api/pf-ai-agent/cimd/callback';
const CIMD_METADATA_PATH = '/api/pf-ai-agent/cimd/client-metadata.json';

function value(store, key) {
  return String(store.getEffective(key) || '').trim();
}

function configError(code, feature, missing) {
  const error = new Error(`PingFederate AI Agent ${feature} configuration is incomplete`);
  error.code = code;
  error.httpStatus = 503;
  error.isConfigError = true;
  error.details = { missing };
  return error;
}

function assertHttpsEndpoint(rawValue, field, issuerOrigin, missing) {
  if (!rawValue) {
    missing.push(field);
    return '';
  }
  let parsed;
  try { parsed = new URL(rawValue); } catch { missing.push(field); return ''; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    missing.push(field);
    return '';
  }
  // Inside Docker these settings name PingFederate by its network alias, a host
  // that is not the issuer's. Keep the configured path but only ever on the
  // issuer's own origin — the rule refresh-service-envs.js applies for
  // PingGateway. A request can therefore never leave the issuer's host, which
  // is what rejecting a foreign origin was protecting.
  if (issuerOrigin && parsed.origin !== issuerOrigin) {
    const issuer = new URL(issuerOrigin);
    parsed.protocol = issuer.protocol;
    parsed.host = issuer.host;
  }
  return parsed.toString();
}

function resolveCimdConfig(store = configStore) {
  const missing = [];
  const rawIssuer = value(store, 'pf_issuer').replace(/\/$/, '');
  let issuer = '';
  let issuerOrigin = '';
  try {
    const parsed = new URL(rawIssuer);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error();
    issuer = parsed.toString().replace(/\/$/, '');
    issuerOrigin = parsed.origin;
  } catch { missing.push('PF_ISSUER'); }

  const authorizationEndpoint = assertHttpsEndpoint(
    value(store, 'pf_authorization_endpoint'), 'PF_AUTHORIZATION_ENDPOINT', issuerOrigin, missing,
  );
  const tokenEndpoint = assertHttpsEndpoint(
    value(store, 'pf_token_endpoint'), 'PF_TOKEN_ENDPOINT', issuerOrigin, missing,
  );
  const jwksUri = assertHttpsEndpoint(
    value(store, 'pf_jwks_uri'), 'PF_JWKS_URI', issuerOrigin, missing,
  );
  const rawPar = value(store, 'pf_par_endpoint');
  const parEndpoint = rawPar
    ? assertHttpsEndpoint(rawPar, 'PF_PAR_ENDPOINT', issuerOrigin, missing)
    : '';

  const discoveryEndpoint = assertHttpsEndpoint(
    value(store, 'pf_discovery_endpoint') || `${issuer}/.well-known/openid-configuration`,
    'PF_DISCOVERY_ENDPOINT', issuerOrigin, missing,
  );

  if (missing.length) throw configError('PF_AI_CIMD_CONFIG_INVALID', 'CIMD', missing);

  const frontendOrigin = getFrontendOrigin();
  let origin;
  try {
    const parsed = new URL(frontendOrigin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error();
    origin = parsed.origin;
  } catch {
    throw configError('PF_AI_CIMD_CONFIG_INVALID', 'CIMD', ['PUBLIC_APP_URL']);
  }

  return {
    issuer,
    discoveryEndpoint,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    parEndpoint,
    clientMetadataUrl: `${origin}${CIMD_METADATA_PATH}`,
    redirectUri: `${origin}${CIMD_CALLBACK_PATH}`,
  };
}

function resolveCrossDomainConfig(store = configStore) {
  const missing = [];
  const issuer = value(store, 'pf_issuer').replace(/\/$/, '');
  let issuerOrigin = '';
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
    issuerOrigin = parsed.origin;
  } catch { missing.push('PF_ISSUER'); }

  const pfJwksUri = assertHttpsEndpoint(value(store, 'pf_jwks_uri'), 'PF_JWKS_URI', issuerOrigin, missing);

  const rawPfEndpoint = value(store, 'pf_token_endpoint');
  const pfTokenEndpoint = assertHttpsEndpoint(rawPfEndpoint, 'PF_TOKEN_ENDPOINT', issuerOrigin, missing);
  const thirdPartyTokenEndpoint = assertHttpsEndpoint(
    value(store, 'pf_ai_third_party_token_endpoint'),
    'PF_AI_THIRD_PARTY_TOKEN_ENDPOINT',
    '',
    missing,
  );
  const pfClientId = value(store, 'pf_ai_cross_domain_client_id');
  const pfClientSecret = value(store, 'pf_ai_cross_domain_client_secret');
  const pfAuthMethod = (value(store, 'pf_ai_cross_domain_token_endpoint_auth_method') || 'basic').toLowerCase();
  const audience = value(store, 'pf_ai_cross_domain_audience');
  const resource = value(store, 'pf_ai_cross_domain_resource');
  const scope = value(store, 'pf_ai_cross_domain_scope');
  const thirdPartyClientId = value(store, 'pf_ai_third_party_client_id');
  const thirdPartyClientSecret = value(store, 'pf_ai_third_party_client_secret');
  const thirdPartyAuthMethod = (value(store, 'pf_ai_third_party_token_endpoint_auth_method') || 'basic').toLowerCase();
  const thirdPartyResource = value(store, 'pf_ai_third_party_resource');
  const thirdPartyScope = value(store, 'pf_ai_third_party_scope');

  for (const [field, candidate] of Object.entries({
    PF_AI_CROSS_DOMAIN_CLIENT_ID: pfClientId,
    PF_AI_CROSS_DOMAIN_CLIENT_SECRET: pfClientSecret,
    PF_AI_CROSS_DOMAIN_AUDIENCE: audience,
    PF_AI_CROSS_DOMAIN_RESOURCE: resource,
    PF_AI_CROSS_DOMAIN_SCOPE: scope,
    PF_AI_THIRD_PARTY_CLIENT_ID: thirdPartyClientId,
    PF_AI_THIRD_PARTY_CLIENT_SECRET: thirdPartyClientSecret,
    PF_AI_THIRD_PARTY_RESOURCE: thirdPartyResource,
    PF_AI_THIRD_PARTY_SCOPE: thirdPartyScope,
  })) if (!candidate) missing.push(field);

  for (const [field, candidate] of [
    ['PF_AI_CROSS_DOMAIN_RESOURCE', resource],
    ['PF_AI_THIRD_PARTY_RESOURCE', thirdPartyResource],
  ]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error();
    } catch { if (candidate) missing.push(field); }
  }

  if (!['basic', 'post'].includes(pfAuthMethod)) missing.push('PF_AI_CROSS_DOMAIN_TOKEN_ENDPOINT_AUTH_METHOD');
  if (!['basic', 'post'].includes(thirdPartyAuthMethod)) missing.push('PF_AI_THIRD_PARTY_TOKEN_ENDPOINT_AUTH_METHOD');
  try {
    const parsed = new URL(audience);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error();
  } catch { if (audience) missing.push('PF_AI_CROSS_DOMAIN_AUDIENCE'); }

  if (missing.length) throw configError('PF_AI_CROSS_DOMAIN_CONFIG_INVALID', 'cross-domain exchange', missing);

  return {
    pfIssuer: issuer,
    pfJwksUri,
    pfTokenEndpoint,
    pfClientId,
    pfClientSecret,
    pfAuthMethod,
    audience,
    resource,
    scope,
    thirdPartyTokenEndpoint,
    thirdPartyClientId,
    thirdPartyClientSecret,
    thirdPartyAuthMethod,
    thirdPartyResource,
    thirdPartyScope,
  };
}

function enabled(store, key) {
  return value(store, key).toLowerCase() === 'true';
}

function available(resolver, store) {
  try { resolver(store); return true; } catch { return false; }
}

function getFeatureStatus(store = configStore) {
  const cimdConfigured = available(resolveCimdConfig, store);
  const crossDomainConfigured = available(resolveCrossDomainConfig, store);
  const rarConfigured = cimdConfigured && Boolean(value(store, 'pf_par_endpoint'));
  return {
    cimd: enabled(store, 'pf_ai_cimd_enabled') && cimdConfigured,
    crossDomain: enabled(store, 'pf_ai_cross_domain_enabled') && crossDomainConfigured,
    rar: enabled(store, 'pf_ai_rar_enabled') && rarConfigured,
  };
}

module.exports = {
  CIMD_CALLBACK_PATH,
  CIMD_METADATA_PATH,
  resolveCimdConfig,
  resolveCrossDomainConfig,
  getFeatureStatus,
};
