'use strict';

const crypto = require('crypto');
const configStore = require('./configStore');
const {
  getFeatureStatus,
  resolveCimdConfig,
} = require('./pfAiAgentFeatureConfig');
const {
  oauthError,
  discoverPf,
  createPkce,
  buildAuthorizationUrl,
  loginHintFor,
  exchangeAuthorizationCode,
} = require('./pfAiAgentOAuthService');

const FLOW_TTL_MS = 5 * 60 * 1000;
const CIMD_SCOPE = 'openid profile email agent:invoke transactions:write';

function metadataDocument(config) {
  return {
    client_id: config.clientMetadataUrl,
    client_name: 'AI Demo PingFederate Agent',
    redirect_uris: [config.redirectUri],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: CIMD_SCOPE,
    token_endpoint_auth_method: 'none',
  };
}

function ensureEnabled(store) {
  if (!getFeatureStatus(store).cimd) {
    throw oauthError('PF_AI_CIMD_NOT_CONFIGURED', 'PingFederate CIMD is not enabled or configured', 503);
  }
}

function ensureSession(req) {
  if (!req?.session) throw oauthError('PF_AI_SESSION_REQUIRED', 'An application session is required', 401);
  req.session.pfAiAgent ||= {};
  return req.session.pfAiAgent;
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function noPendingFlow(state) {
  const error = oauthError('PF_AI_CIMD_CALLBACK_INVALID', 'PF CIMD callback state was invalid or expired', 400);
  error.state = state;
  return error;
}

async function beginCimd(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  ensureEnabled(store);
  const featureSession = ensureSession(req);
  for (const key of ['cimdPending', 'rarPending']) {
    if (featureSession[key] && (!Number.isFinite(featureSession[key].expiresAt)
      || featureSession[key].expiresAt <= now())) delete featureSession[key];
  }
  if (featureSession.cimdPending || featureSession.rarPending) {
    throw oauthError('PF_AI_FLOW_ALREADY_PENDING', 'A PF AI Agent authorization flow is already pending', 409);
  }
  const config = resolveCimdConfig(store);
  const metadata = await discoverPf(config, fetchImpl);
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkce();
  const createdAt = now();
  featureSession.cimdPending = {
    state,
    nonce,
    verifier,
    createdAt,
    expiresAt: createdAt + FLOW_TTL_MS,
  };
  delete featureSession.cimdTokens;
  return {
    redirectUrl: buildAuthorizationUrl({
      metadata,
      clientId: config.clientMetadataUrl,
      redirectUri: config.redirectUri,
      scope: CIMD_SCOPE,
      state,
      nonce,
      challenge,
      loginHint: loginHintFor(req),
    }),
  };
}

async function completeCimd(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const featureSession = ensureSession(req);
  const pending = featureSession.cimdPending;
  const queryState = req?.query?.state;
  if (!pending || !secureEqual(queryState, pending.state)) {
    throw noPendingFlow(queryState);
  }
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= now()) {
    delete featureSession.cimdPending;
    throw noPendingFlow(queryState);
  }
  delete featureSession.cimdPending;
  if (req?.query?.error || typeof req?.query?.code !== 'string' || !req.query.code) throw noPendingFlow(queryState);

  const config = resolveCimdConfig(store);
  const metadata = await discoverPf(config, fetchImpl);
  const { tokenSet, identity } = await exchangeAuthorizationCode({
    config,
    metadata,
    clientId: config.clientMetadataUrl,
    redirectUri: config.redirectUri,
    code: req.query.code,
    verifier: pending.verifier,
    nonce: pending.nonce,
  }, fetchImpl);
  featureSession.cimdTokens = tokenSet;
  return identity;
}

module.exports = {
  CIMD_SCOPE,
  FLOW_TTL_MS,
  metadataDocument,
  beginCimd,
  completeCimd,
};
