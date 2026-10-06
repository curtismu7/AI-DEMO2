'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const { getFeatureStatus, resolveCrossDomainConfig } = require('./pfAiAgentFeatureConfig');
const { oauthError, REQUEST_TIMEOUT_MS } = require('./pfAiAgentOAuthService');
const { safeParams, safeBody, bareUrl, claimsOf, headerOf, step: traceStep } = require('./pfAiAgentTrace');

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const ALLOWED_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);

function normalizedProvider(req) {
  return String(req?.session?.oauthProvider || req?.session?.user?.oauthProvider || '').toLowerCase();
}

// The access token PingFederate issued to the page's own CIMD sign-in, if there is a usable one. The CIMD flow keeps
// it apart from the active session, so a user signed in to the app through PingOne can still sign in at PingFederate
// and exchange that token (PingFederate trusts only tokens it issued itself).
function cimdPingFederateToken(req) {
  const tokens = req?.session?.pfAiAgent?.cimdTokens;
  const usable = tokens && typeof tokens.accessToken === 'string' && tokens.accessToken.trim()
    && !tokens.dpopJkt && (!tokens.expiresAt || tokens.expiresAt > Date.now());
  return usable ? tokens.accessToken : null;
}

function sessionSubjectToken(req, subjectProvider) {
  const actualProvider = normalizedProvider(req);
  if (subjectProvider === 'pingfederate' && actualProvider !== 'pingfederate') {
    const cimdToken = cimdPingFederateToken(req);
    if (cimdToken) return cimdToken;
  }
  if (!['pingone', 'pingfederate'].includes(subjectProvider) || actualProvider !== subjectProvider) {
    throw oauthError('PF_AI_SUBJECT_PROVIDER_MISMATCH', 'Selected source does not match the authenticated session', 403);
  }
  const token = req?.session?.oauthTokens?.accessToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw oauthError('PF_AI_SUBJECT_TOKEN_MISSING', 'The selected session has no access token', 401);
  }
  return token;
}

// The header the client authenticated with, for the page's proof: shown, never with the credential.
function clientAuthHeaders(method) {
  return method === 'basic' ? { Authorization: 'Basic <client_id:client_secret, redacted>' } : {};
}

function setClientAuthentication(body, headers, clientId, clientSecret, method) {
  if (method === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }
}

async function postForm(fetchImpl, endpoint, body, client) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
  setClientAuthentication(body, headers, client.id, client.secret, client.method);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw oauthError('PF_AI_UPSTREAM_UNAVAILABLE', 'A configured authorization server could not be reached');
  }
  if (!response?.ok) {
    let detail = {};
    try { detail = await response.json(); } catch { /* an error body is optional */ }
    // PingFederate's subject-token processor only trusts PingFederate-issued tokens, so a PingOne session
    // fails here. Say that, instead of a generic refusal.
    if (/issuer was not recognized/i.test(String(detail?.error_description || ''))) {
      throw oauthError('PF_AI_SUBJECT_ISSUER_NOT_RECOGNIZED', 'PingFederate does not recognize the issuer of the session token', 422);
    }
    throw oauthError('PF_AI_UPSTREAM_REJECTED', 'A configured authorization server rejected the request', 502);
  }
  try { return await response.json(); } catch {
    throw oauthError('PF_AI_UPSTREAM_RESPONSE_INVALID', 'A configured authorization server returned an invalid response');
  }
}

function scopeList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean)
    : String(value || '').split(/\s+/).filter(Boolean);
}

function constantTimeTokenType(value) {
  return value === ID_JAG_TOKEN_TYPE;
}

async function verifyIdJag(assertion, config, fetchImpl, responseScope = '') {
  if (typeof assertion !== 'string' || !assertion) {
    throw oauthError('PF_AI_ID_JAG_MISSING', 'PingFederate did not return an ID-JAG assertion');
  }
  const decoded = jwt.decode(assertion, { complete: true });
  const header = decoded?.header;
  if (!header?.kid || !ALLOWED_ALGORITHMS.has(header.alg)) {
    throw oauthError('PF_AI_ID_JAG_UNSUPPORTED', 'PingFederate returned an unsupported ID-JAG');
  }
  let jwksResponse;
  try {
    jwksResponse = await fetchImpl(config.pfJwksUri, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw oauthError('PF_AI_JWKS_FAILED', 'PingFederate signing keys could not be retrieved');
  }
  if (!jwksResponse?.ok) throw oauthError('PF_AI_JWKS_FAILED', 'PingFederate signing keys could not be retrieved');
  let jwks;
  try { jwks = await jwksResponse.json(); } catch {
    throw oauthError('PF_AI_JWKS_FAILED', 'PingFederate signing keys were invalid');
  }
  const expectedKty = header.alg.startsWith('RS') ? 'RSA' : 'EC';
  const jwk = jwks?.keys?.find((candidate) => candidate.kid === header.kid
    && candidate.kty === expectedKty && (!candidate.use || candidate.use === 'sig')
    && (!candidate.alg || candidate.alg === header.alg));
  if (!jwk) throw oauthError('PF_AI_ID_JAG_KEY_NOT_FOUND', 'PingFederate ID-JAG signing key was not found');

  let claims;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    claims = jwt.verify(assertion, key, {
      algorithms: [header.alg], issuer: config.pfIssuer, audience: config.audience,
    });
  } catch (error) {
    // One code per cause, so a failed run says whether it was the key, the issuer, the audience or the clock.
    const message = String(error?.message || '');
    const code = /audience/.test(message) ? 'PF_AI_ID_JAG_AUDIENCE_INVALID'
      : /issuer/.test(message) ? 'PF_AI_ID_JAG_ISSUER_INVALID'
        : /expired/.test(message) ? 'PF_AI_ID_JAG_EXPIRED'
          : 'PF_AI_ID_JAG_SIGNATURE_INVALID';
    throw oauthError(code, 'PingFederate ID-JAG signature, issuer, audience, or expiry was invalid');
  }
  const scopes = scopeList(claims.scope || claims.scp || responseScope);
  const requestedScopes = scopeList(config.scope);
  const resourceClaim = claims.resource ?? claims.rsrc;
  const resourceList = resourceClaim === undefined ? [] : scopeList(resourceClaim);
  if (!claims.sub || !Number.isFinite(claims.exp)) {
    throw oauthError('PF_AI_ID_JAG_CLAIMS_INVALID', 'PingFederate ID-JAG has no subject or expiry');
  }
  if (requestedScopes.some((scope) => !scopes.includes(scope))
    || scopes.some((scope) => !requestedScopes.includes(scope))) {
    throw oauthError('PF_AI_ID_JAG_SCOPE_MISMATCH', 'PingFederate ID-JAG scope did not match the requested scope');
  }
  if (resourceClaim !== undefined && !resourceList.includes(config.resource)) {
    throw oauthError('PF_AI_ID_JAG_RESOURCE_MISMATCH', 'PingFederate ID-JAG resource did not match the requested resource');
  }
  return {
    subject: String(claims.sub),
    scopes,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

async function exchangeForThirdPartyAccessToken(req, {
  subjectProvider,
  store = configStore,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const subjectToken = sessionSubjectToken(req, subjectProvider);
  if (!getFeatureStatus(store).crossDomain) {
    throw oauthError('PF_AI_CROSS_DOMAIN_NOT_CONFIGURED', 'PF AI Agent cross-domain exchange is not enabled or configured', 503);
  }
  const config = resolveCrossDomainConfig(store);

  const pfRequest = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ID_JAG_TOKEN_TYPE,
    audience: config.audience,
    resource: config.resource,
    scope: config.scope,
  });
  const pfResponse = await postForm(fetchImpl, config.pfTokenEndpoint, pfRequest, {
    id: config.pfClientId,
    secret: config.pfClientSecret,
    method: config.pfAuthMethod,
  });
  if (!constantTimeTokenType(pfResponse.issued_token_type)) {
    throw oauthError('PF_AI_ID_JAG_INVALID', 'PingFederate returned an unexpected token type');
  }
  const identity = await verifyIdJag(pfResponse.access_token, config, fetchImpl, pfResponse.scope);

  const downstreamRequest = new URLSearchParams({
    grant_type: JWT_BEARER_GRANT,
    assertion: pfResponse.access_token,
    scope: config.thirdPartyScope,
    resource: config.thirdPartyResource,
  });
  const downstreamResponse = await postForm(fetchImpl, config.thirdPartyTokenEndpoint, downstreamRequest, {
    id: config.thirdPartyClientId,
    secret: config.thirdPartyClientSecret,
    method: config.thirdPartyAuthMethod,
  });
  if (typeof downstreamResponse.access_token !== 'string' || !downstreamResponse.access_token) {
    throw oauthError('PF_AI_DOWNSTREAM_RESPONSE_INVALID', 'The downstream token response did not contain an access token');
  }
  const downstreamScope = scopeList(downstreamResponse.scope || config.thirdPartyScope);
  const requestedDownstreamScopes = scopeList(config.thirdPartyScope);
  if (downstreamScope.some((scope) => !requestedDownstreamScopes.includes(scope))) {
    throw oauthError('PF_AI_DOWNSTREAM_SCOPE_INVALID', 'The downstream authorization server returned an unexpected scope');
  }
  const expiresAt = Number.isFinite(downstreamResponse.expires_in) && downstreamResponse.expires_in > 0
    ? new Date(now() + downstreamResponse.expires_in * 1000).toISOString()
    : null;
  const downstreamIssuer = new URL(config.thirdPartyTokenEndpoint).origin;

  // The proof the page shows: what went to PingFederate, the ID-JAG it issued (decoded), what the BFF checked, and the
  // redemption at the third-party server. Every secret is replaced (see pfAiAgentTrace).
  const usedCimdSignIn = subjectProvider === 'pingfederate' && normalizedProvider(req) !== 'pingfederate';
  const idJagHeader = headerOf(pfResponse.access_token);
  const trace = [
    traceStep({
      id: 'pf-exchange',
      title: 'Ask PingFederate for an ID-JAG (token exchange, RFC 8693)',
      request: {
        method: 'POST',
        url: bareUrl(config.pfTokenEndpoint),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...clientAuthHeaders(config.pfAuthMethod) },
        params: safeParams(pfRequest),
      },
      response: { status: 200, body: safeBody(pfResponse) },
      claims: { idJagHeader, idJag: claimsOf(pfResponse.access_token) },
      note: usedCimdSignIn ? "The subject token is the PingFederate token from the CIMD sign-in, not the app's PingOne session." : null,
    }),
    traceStep({
      id: 'verify',
      title: 'The BFF checks the ID-JAG before using it',
      note: `Signature verified with PingFederate's published key (kid ${idJagHeader?.kid}); issuer ${config.pfIssuer}; audience ${config.audience}; scope ${identity.scopes.join(' ')}; resource ${config.resource}.`,
    }),
    traceStep({
      id: 'redeem',
      title: 'Redeem the ID-JAG at the third-party server (JWT bearer, RFC 7523)',
      request: {
        method: 'POST',
        url: bareUrl(config.thirdPartyTokenEndpoint),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...clientAuthHeaders(config.thirdPartyAuthMethod) },
        params: safeParams(downstreamRequest),
      },
      response: { status: 200, body: safeBody(downstreamResponse) },
      claims: { downstreamAccessToken: claimsOf(downstreamResponse.access_token) },
    }),
  ];

  return {
    trace,
    subjectProvider,
    pfIssuer: config.pfIssuer,
    assertionAudience: config.audience,
    downstreamIssuer,
    downstreamAudience: config.thirdPartyResource,
    subject: identity.subject,
    scope: downstreamScope,
    expiresAt,
    hops: [
      {
        step: 'pf-id-jag-issuance',
        issuer: config.pfIssuer,
        audience: config.audience,
        resource: config.resource,
        tokenType: 'ID-JAG',
        scope: identity.scopes,
      },
      {
        step: 'third-party-jwt-bearer-redemption',
        issuer: downstreamIssuer,
        audience: config.thirdPartyResource,
        tokenType: 'access_token',
        scope: downstreamScope,
      },
    ],
  };
}

module.exports = {
  ACCESS_TOKEN_TYPE,
  ID_JAG_TOKEN_TYPE,
  TOKEN_EXCHANGE_GRANT,
  JWT_BEARER_GRANT,
  exchangeForThirdPartyAccessToken,
  cimdPingFederateToken,
  verifyIdJag,
};
