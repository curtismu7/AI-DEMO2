'use strict';

/**
 * AIC token-exchange demo — the two input tokens for an RFC 8693 delegation
 * exchange performed AT PingOne Advanced Identity Cloud (AIC):
 *
 *   user token   a person signs in DIRECTLY at AIC (authorization code + PKCE on a
 *                public client). This is a second sign-in beside the app's own
 *                PingOne session: AIC only exchanges tokens it issued itself, and the
 *                app's normal login only ever yields PingOne tokens.
 *   actor token  client credentials on a confidential AIC client (the agent).
 *
 * Tokens stay in the BFF session (req.session.aicDemo); the browser only ever gets
 * the redacted trace built with pfAiAgentTrace.
 */

const crypto = require('crypto');
const configStore = require('./configStore');
const { getFrontendOrigin } = require('./oauthRedirectUris');
const {
  REQUEST_TIMEOUT_MS,
  oauthError,
  createPkce,
  buildAuthorizationUrl,
  verifyIdToken,
} = require('./pfAiAgentOAuthService');
const { safeParams, safeBody, bareUrl, claimsOf, redacted, step: traceStep } = require('./pfAiAgentTrace');

const FLOW_TTL_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/api/aic-demo/callback';

function resolveConfig(store = configStore) {
  const get = (key) => String(store.getEffective(key) || '').trim();
  const delegatedScope = get('aic_delegated_scope');
  return {
    issuer: get('aic_issuer'),
    subjectClientId: get('aic_subject_client_id'),
    actorClientId: get('aic_actor_client_id'),
    actorClientSecret: get('aic_actor_client_secret'),
    delegatedScope,
    userScope: ['openid', 'profile', 'email', delegatedScope].filter(Boolean).join(' '),
    redirectUri: `${getFrontendOrigin()}${CALLBACK_PATH}`,
  };
}

function featureStatus(store = configStore) {
  const config = resolveConfig(store);
  return {
    login: Boolean(config.issuer && config.subjectClientId),
    actor: Boolean(config.issuer && config.actorClientId && config.actorClientSecret),
  };
}

function endpointOf(value, issuerUrl, field, required = true) {
  if (!value && !required) return '';
  let parsed;
  try { parsed = new URL(value); } catch { throw oauthError('AIC_DISCOVERY_INVALID', `AIC ${field} is invalid`); }
  // AIC advertises an explicit :443; URL normalises that away, so comparing hostnames is exact enough.
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname !== issuerUrl.hostname) {
    throw oauthError('AIC_DISCOVERY_INVALID', `AIC ${field} is not on the issuer's host`);
  }
  return parsed.toString();
}

async function discover(config, fetchImpl = fetch) {
  let issuerUrl;
  try { issuerUrl = new URL(config.issuer); } catch { throw oauthError('AIC_NOT_CONFIGURED', 'AIC issuer is not configured', 503); }
  if (issuerUrl.protocol !== 'https:') throw oauthError('AIC_NOT_CONFIGURED', 'AIC issuer must use HTTPS', 503);
  const response = await fetchImpl(`${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response?.ok) throw oauthError('AIC_DISCOVERY_FAILED', 'AIC discovery request failed');
  const document = await response.json().catch(() => null);
  // The ID token's iss must equal this string exactly, explicit port and all.
  if (!document || document.issuer !== config.issuer) {
    throw oauthError('AIC_DISCOVERY_INVALID', `AIC discovery issuer "${document?.issuer}" does not match the configured issuer`);
  }
  return {
    issuer: document.issuer,
    authorizationEndpoint: endpointOf(document.authorization_endpoint, issuerUrl, 'authorization endpoint'),
    tokenEndpoint: endpointOf(document.token_endpoint, issuerUrl, 'token endpoint'),
    jwksUri: endpointOf(document.jwks_uri, issuerUrl, 'JWKS URI'),
    introspectionEndpoint: endpointOf(document.introspection_endpoint, issuerUrl, 'introspection endpoint', false),
  };
}

// One form POST for every AIC call. AIC's own error and error_description are kept:
// they are not secret, and they are what tells you which client setting is wrong.
async function postForm(fetchImpl, endpoint, body, client = null) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
  if (client) headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: Boolean(response.ok), status: response.status, json };
}

function rejected(code, label, result) {
  const detail = [result.json?.error, result.json?.error_description].filter(Boolean).join(': ');
  const error = oauthError(code, `AIC rejected the ${label}${detail ? ` (${detail})` : ''}`);
  error.detail = detail || null;
  return error;
}

function ensureSession(req) {
  if (!req?.session) throw oauthError('AIC_SESSION_REQUIRED', 'An application session is required', 401);
  req.session.aicDemo ||= {};
  return req.session.aicDemo;
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// AIC access tokens are opaque unless client-side tokens are switched on, so the only way to
// see what one carries (may_act included) is to ask AIC. A client may always introspect its own
// tokens; another client's token comes back inactive unless the caller holds am-introspect-all-tokens.
async function introspectStep({ fetchImpl, metadata, config, token, id, title }) {
  if (!metadata.introspectionEndpoint || !config.actorClientId || !config.actorClientSecret) return null;
  const result = await postForm(fetchImpl, metadata.introspectionEndpoint, new URLSearchParams({ token }),
    { id: config.actorClientId, secret: config.actorClientSecret });
  return traceStep({
    id,
    title,
    request: {
      method: 'POST',
      url: bareUrl(metadata.introspectionEndpoint),
      headers: { Authorization: `Basic <${config.actorClientId}:redacted>` },
      params: { token: redacted(token) },
    },
    response: { status: result.status, body: safeBody(result.json) },
    note: result.ok && result.json?.active === false
      ? `AIC reports this token inactive to ${config.actorClientId}: a client can only introspect its own tokens unless it is granted the am-introspect-all-tokens scope.`
      : null,
  });
}

async function beginLogin(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const config = resolveConfig(store);
  if (!config.issuer || !config.subjectClientId) {
    throw oauthError('AIC_NOT_CONFIGURED', 'Set aic_issuer and aic_subject_client_id', 503);
  }
  const demo = ensureSession(req);
  const metadata = await discover(config, fetchImpl);
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkce();
  const redirectUrl = buildAuthorizationUrl({
    metadata, clientId: config.subjectClientId, redirectUri: config.redirectUri, scope: config.userScope, state, nonce, challenge,
  });
  const createdAt = now();
  demo.pending = {
    state, nonce, verifier, createdAt, expiresAt: createdAt + FLOW_TTL_MS,
    trace: [traceStep({
      id: 'authorize',
      title: 'Send the user to sign in at AIC',
      request: { method: 'GET', url: bareUrl(redirectUrl), params: safeParams(new URL(redirectUrl).searchParams) },
    })],
  };
  delete demo.userTokens;
  delete demo.userResult;
  return { redirectUrl };
}

async function completeLogin(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const demo = ensureSession(req);
  const pending = demo.pending;
  delete demo.pending;
  if (!pending || !secureEqual(req?.query?.state, pending.state)
    || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now()) {
    throw oauthError('AIC_CALLBACK_INVALID', 'AIC callback state was invalid or expired', 400);
  }
  if (req.query.error || typeof req.query.code !== 'string' || !req.query.code) {
    const error = oauthError('AIC_SIGN_IN_REFUSED', 'AIC did not return an authorization code', 400);
    error.detail = [req.query.error, req.query.error_description].filter((v) => typeof v === 'string' && v).join(': ') || null;
    throw error;
  }
  const config = resolveConfig(store);
  const metadata = await discover(config, fetchImpl);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: req.query.code,
    client_id: config.subjectClientId,
    redirect_uri: config.redirectUri,
    code_verifier: pending.verifier,
  });
  const result = await postForm(fetchImpl, metadata.tokenEndpoint, body);
  const tokens = result.json;
  if (!result.ok) throw rejected('AIC_CODE_REJECTED', 'authorization code', result);
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.id_token !== 'string' || !tokens.id_token) {
    throw oauthError('AIC_TOKEN_RESPONSE_INVALID', 'AIC token response did not contain an access token and an ID token');
  }
  const jwksResponse = await fetchImpl(metadata.jwksUri, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!jwksResponse?.ok) throw oauthError('AIC_JWKS_FAILED', 'AIC JWKS request failed');
  const identity = verifyIdToken(tokens.id_token, {
    config: { issuer: metadata.issuer }, metadata, clientId: config.subjectClientId, nonce: pending.nonce, jwks: await jwksResponse.json(),
  });
  demo.userTokens = {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    scope: typeof tokens.scope === 'string' ? tokens.scope : '',
    expiresAt: Number.isFinite(tokens.expires_in) ? now() + tokens.expires_in * 1000 : null,
    subject: identity.subject,
  };
  const introspection = await introspectStep({
    fetchImpl, metadata, config, token: tokens.access_token, id: 'introspect-user', title: 'Ask AIC what the user token carries',
  }).catch(() => null);
  demo.userResult = {
    trace: [
      ...(pending.trace || []),
      traceStep({
        id: 'callback',
        title: 'AIC sends the user back with a code',
        request: { method: 'GET', url: bareUrl(config.redirectUri), params: safeParams({ code: req.query.code, state: req.query.state }) },
      }),
      traceStep({
        id: 'token',
        title: 'Redeem the code for the user token',
        request: {
          method: 'POST', url: bareUrl(metadata.tokenEndpoint),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, params: safeParams(body),
        },
        response: { status: result.status, body: safeBody(tokens) },
        claims: { idToken: claimsOf(tokens.id_token), accessToken: claimsOf(tokens.access_token) },
      }),
      ...(introspection ? [introspection] : []),
    ],
    subject: identity.subject,
    issuer: identity.issuer,
    scope: demo.userTokens.scope,
    opaque: !claimsOf(tokens.access_token),
    completedAt: new Date(now()).toISOString(),
  };
  return identity;
}

async function fetchActorToken(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const config = resolveConfig(store);
  if (!config.issuer || !config.actorClientId || !config.actorClientSecret) {
    throw oauthError('AIC_NOT_CONFIGURED', 'Set aic_issuer, aic_actor_client_id and aic_actor_client_secret', 503);
  }
  const demo = ensureSession(req);
  const metadata = await discover(config, fetchImpl);
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (config.delegatedScope) body.set('scope', config.delegatedScope);
  const result = await postForm(fetchImpl, metadata.tokenEndpoint, body, { id: config.actorClientId, secret: config.actorClientSecret });
  const tokens = result.json;
  if (!result.ok) throw rejected('AIC_ACTOR_TOKEN_REJECTED', 'client credentials request', result);
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw oauthError('AIC_TOKEN_RESPONSE_INVALID', 'AIC token response did not contain an access token');
  }
  demo.actorTokens = {
    accessToken: tokens.access_token,
    scope: typeof tokens.scope === 'string' ? tokens.scope : '',
    expiresAt: Number.isFinite(tokens.expires_in) ? now() + tokens.expires_in * 1000 : null,
  };
  const introspection = await introspectStep({
    fetchImpl, metadata, config, token: tokens.access_token, id: 'introspect-actor', title: 'Ask AIC what the actor token carries',
  }).catch(() => null);
  demo.actorResult = {
    trace: [
      traceStep({
        id: 'actor-token',
        title: 'The agent gets its own token with client credentials',
        request: {
          method: 'POST', url: bareUrl(metadata.tokenEndpoint),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic <${config.actorClientId}:redacted>` },
          params: safeParams(body),
        },
        response: { status: result.status, body: safeBody(tokens) },
        claims: { accessToken: claimsOf(tokens.access_token) },
      }),
      ...(introspection ? [introspection] : []),
    ],
    clientId: config.actorClientId,
    scope: demo.actorTokens.scope,
    opaque: !claimsOf(tokens.access_token),
    completedAt: new Date(now()).toISOString(),
  };
  return demo.actorResult;
}

function usable(tokens, now = Date.now) {
  return Boolean(tokens?.accessToken && (!tokens.expiresAt || tokens.expiresAt > now()));
}

module.exports = {
  CALLBACK_PATH,
  resolveConfig,
  featureStatus,
  beginLogin,
  completeLogin,
  fetchActorToken,
  usable,
};
