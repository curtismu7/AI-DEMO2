'use strict';

const crypto = require('crypto');
const configStore = require('./configStore');
const defaultDataStore = require('../data/store');
const { getFeatureStatus, resolveCimdConfig } = require('./pfAiAgentFeatureConfig');
const { generateDpopKeypair } = require('./dpopKeyService');
const {
  oauthError,
  discoverPf,
  createPkce,
  exchangeAuthorizationCode,
  REQUEST_TIMEOUT_MS,
} = require('./pfAiAgentOAuthService');

const RAR_TYPE = 'banking_transaction';
const RAR_SCOPE = 'openid profile email transactions:write';
// The daily domestic transfer limit (graphify-out/banking-domain.kb.json).
const RAR_TRANSACTION_LIMIT = 5000;
const FLOW_TTL_MS = 5 * 60 * 1000;
// PingFederate's answers that mean "the request was refused", not "something broke":
// the user said no, or the processor refused the authorization details (RFC 9396).
const DENIAL_REASONS = {
  access_denied: 'authorization_rejected',
  invalid_authorization_details: 'authorization_details_refused',
};
const REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:';

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionUserKey(req, requested) {
  const candidate = typeof requested === 'string' && requested.trim()
    ? requested.trim()
    : String(req?.session?.user?.username || req?.session?.user?.oauthId || '').trim();
  if (!candidate || candidate.length > 256 || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw oauthError('PF_AI_RAR_USER_REQUIRED', 'A PF user key is required for the RAR demonstration', 400);
  }
  return candidate;
}

// PingFederate signs a user in under its own spelling ("demouser"), the store holds
// "demoUser". An exact match wins; otherwise a case-insensitive one counts only when it
// is unambiguous, so two users that differ only by case never resolve to either.
function findUser(username, dataStore) {
  const exact = dataStore.getUserByUsername(username);
  if (exact || typeof dataStore.getAllUsers !== 'function') return exact;
  const wanted = username.toLowerCase();
  const matches = dataStore.getAllUsers().filter((user) => String(user.username || '').toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * What the PingFederate processor checks a banking_transaction against, for one
 * banking user: their own accounts, the daily domestic transfer limit and the
 * currency. Null when the user or their accounts are unknown.
 */
function userLimits(username, dataStore = defaultDataStore) {
  const user = typeof username === 'string' && username ? findUser(username, dataStore) : null;
  const accounts = user ? dataStore.getAccountsByUserId(user.id) : [];
  if (!accounts.length) return null;
  return {
    user_id: username,
    account_ids: accounts.map((account) => String(account.id)),
    transaction_limit: RAR_TRANSACTION_LIMIT,
    currency: accounts[0].currency || 'USD',
  };
}

function buildAuthorizationDetail(scenario, userKey, limits = null) {
  const allowed = scenario === 'allowed';
  if (!allowed && scenario !== 'denied') {
    throw oauthError('PF_AI_RAR_SCENARIO_INVALID', 'RAR scenario must be allowed or denied', 400);
  }
  // The user's own first two accounts when they have them; otherwise the fixed
  // pair, which only passes a processor fed matching sign-in attributes.
  const [source, destination] = limits?.account_ids?.length >= 2
    ? limits.account_ids
    : ['checking-100', 'savings-200'];
  return {
    type: RAR_TYPE,
    user_id: allowed ? userKey : `${userKey}-outside-policy`,
    actions: ['transfer'],
    source_account: source,
    destination_account: destination,
    amount: 125,
    currency: limits?.currency || 'USD',
  };
}

// PingFederate 13.1 gives a CIMD client no authorization detail types, so RAR
// uses its own registered client when one is configured.
function rarClientId(store, config) {
  return String(store.getEffective('pf_ai_rar_client_id') || '').trim() || config.clientMetadataUrl;
}

async function pushParRequest(config, metadata, values, fetchImpl) {
  const parEndpoint = metadata.parEndpoint || config.parEndpoint;
  if (!parEndpoint) throw oauthError('PF_AI_RAR_CONFIG_INVALID', 'PF PAR is not configured', 503);
  const body = new URLSearchParams({
    response_type: 'code',
    client_id: values.clientId,
    redirect_uri: config.redirectUri,
    scope: RAR_SCOPE,
    state: values.state,
    nonce: values.nonce,
    code_challenge: values.challenge,
    code_challenge_method: 'S256',
    authorization_details: JSON.stringify([values.authorizationDetail]),
  });
  let response;
  try {
    response = await fetchImpl(parEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw oauthError('PF_AI_RAR_PAR_FAILED', 'PingFederate PAR could not be reached');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response?.ok) {
    if (data?.error === 'invalid_authorization_details') {
      throw oauthError('PF_AI_RAR_POLICY_REJECTED', 'PingFederate rejected the authorization details', 422);
    }
    throw oauthError('PF_AI_RAR_PAR_FAILED', 'PingFederate rejected the PAR request');
  }
  const requestUri = data?.request_uri;
  if (typeof requestUri !== 'string' || !requestUri.startsWith(REQUEST_URI_PREFIX)
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 600) {
    throw oauthError('PF_AI_RAR_PAR_RESPONSE_INVALID', 'PingFederate PAR response was invalid');
  }
  const authorizationUrl = new URL(metadata.authorizationEndpoint);
  authorizationUrl.searchParams.set('client_id', values.clientId);
  authorizationUrl.searchParams.set('request_uri', requestUri);
  return authorizationUrl.toString();
}

async function beginRar(req, {
  scenario,
  userKey: requestedUserKey,
  dpop = false,
  store = configStore,
  dataStore = defaultDataStore,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!req?.session) throw oauthError('PF_AI_SESSION_REQUIRED', 'An application session is required', 401);
  if (!getFeatureStatus(store).rar) {
    throw oauthError('PF_AI_RAR_NOT_CONFIGURED', 'PF AI Agent RAR is not enabled or configured', 503);
  }
  // DPoP uses its own client (the one PingFederate is told to require DPoP for), so the plain
  // RAR run keeps working unchanged.
  if (dpop && !getFeatureStatus(store).rarDpop) {
    throw oauthError('PF_AI_RAR_DPOP_NOT_CONFIGURED', 'DPoP binding for RAR is not configured', 503);
  }
  req.session.pfAiAgent ||= {};
  const featureSession = req.session.pfAiAgent;
  for (const key of ['cimdPending', 'rarPending']) {
    if (featureSession[key] && (!Number.isFinite(featureSession[key].expiresAt)
      || featureSession[key].expiresAt <= now())) delete featureSession[key];
  }
  if (featureSession.cimdPending || featureSession.rarPending) {
    throw oauthError('PF_AI_FLOW_ALREADY_PENDING', 'A PF AI Agent authorization flow is already pending', 409);
  }
  const config = resolveCimdConfig(store);
  const userKey = sessionUserKey(req, requestedUserKey);
  const authorizationDetail = buildAuthorizationDetail(scenario, userKey, userLimits(userKey, dataStore));
  const metadata = await discoverPf(config, fetchImpl);
  if (!metadata.parEndpoint && !config.parEndpoint) {
    throw oauthError('PF_AI_RAR_CONFIG_INVALID', 'PF PAR is not configured', 503);
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkce();
  const clientId = dpop
    ? String(store.getEffective('pf_ai_rar_dpop_client_id')).trim()
    : rarClientId(store, config);
  const redirectUrl = await pushParRequest(config, metadata, {
    state, nonce, challenge, authorizationDetail, clientId,
  }, fetchImpl);
  const createdAt = now();
  // A fresh key for this one run; it lives only as long as the pending flow (private key in the
  // server-side session, consumed by completeRar, never sent to the browser).
  const dpopKey = dpop ? generateDpopKeypair() : null;
  featureSession.rarPending = {
    state,
    nonce,
    verifier,
    createdAt,
    expiresAt: createdAt + FLOW_TTL_MS,
    scenario,
    userKey,
    clientId,
    dpopKey,
  };
  delete featureSession.rarResult;
  return { redirectUrl };
}

function safeResult(outcome, reason, pending, identity = null, now = Date.now, tokenSet = null) {
  return {
    outcome,
    reason,
    detailType: RAR_TYPE,
    scenario: pending.scenario,
    subject: identity?.subject || null,
    issuer: identity?.issuer || null,
    expiresAt: identity?.expiresAt || null,
    // What kind of token came back, and for DPoP the public thumbprint of the key it is bound to.
    tokenType: tokenSet?.tokenType || null,
    dpopThumbprint: tokenSet?.dpopJkt || null,
    completedAt: new Date(now()).toISOString(),
  };
}

async function completeRar(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const featureSession = req?.session?.pfAiAgent;
  const pending = featureSession?.rarPending;
  const state = req?.query?.state;
  if (!pending || !secureEqual(state, pending.state)) {
    throw oauthError('PF_AI_RAR_CALLBACK_INVALID', 'PF RAR callback state was invalid', 400);
  }
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= now()) {
    delete featureSession.rarPending;
    throw oauthError('PF_AI_RAR_CALLBACK_INVALID', 'PF RAR callback state expired', 400);
  }
  delete featureSession.rarPending;

  if (req.query?.error) {
    const reason = Object.prototype.hasOwnProperty.call(DENIAL_REASONS, req.query.error)
      ? DENIAL_REASONS[req.query.error]
      : null;
    if (!reason) {
      throw oauthError('PF_AI_RAR_AUTHORIZATION_FAILED', 'PingFederate could not complete the RAR authorization');
    }
    const result = safeResult('denied', reason, pending, null, now);
    featureSession.rarResult = result;
    return result;
  }
  if (typeof req.query?.code !== 'string' || !req.query.code) {
    throw oauthError('PF_AI_RAR_CALLBACK_INVALID', 'PF RAR authorization response was invalid', 400);
  }

  const config = resolveCimdConfig(store);
  const metadata = await discoverPf(config, fetchImpl);
  const { identity, tokenSet } = await exchangeAuthorizationCode({
    config,
    metadata,
    clientId: pending.clientId || rarClientId(store, config),
    redirectUri: config.redirectUri,
    code: req.query.code,
    verifier: pending.verifier,
    nonce: pending.nonce,
    dpop: pending.dpopKey || null,
  }, fetchImpl);
  const result = safeResult('accepted', 'authorized', pending, identity, now, tokenSet);
  featureSession.rarResult = result;
  return result;
}

module.exports = {
  RAR_TYPE,
  RAR_SCOPE,
  FLOW_TTL_MS,
  buildAuthorizationDetail,
  userLimits,
  beginRar,
  completeRar,
};
