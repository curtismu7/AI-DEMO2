'use strict';

const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const cibaService = require('./cibaService');
const { getFeatureStatus, resolveCibaConfig, webApproverOn } = require('./pfAiAgentFeatureConfig');
const {
  oauthError,
  discoverPf,
  verifyIdToken,
  REQUEST_TIMEOUT_MS,
} = require('./pfAiAgentOAuthService');

// CIBA (client-initiated backchannel authentication), poll mode: the BFF names a user, PingFederate
// asks that user's PingOne MFA device to approve, and the page polls until it is approved, denied
// or expired. The auth_req_id, the tokens and the client secret stay in the BFF; the browser only
// ever sees the state and safe metadata.
const CIBA_GRANT = 'urn:openid:params:grant-type:ciba';
const MAX_PENDING_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_SECONDS = 5;
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 30;
const SLOW_DOWN_STEP_SECONDS = 5;
const BINDING_MESSAGE = /^[A-Za-z0-9._+/!?#-]{1,20}$/;

function clampInterval(seconds) {
  const value = Number.isFinite(seconds) ? Math.floor(seconds) : DEFAULT_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, value));
}

function basicAuthorization(config) {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

function sessionLoginHint(req, requested) {
  const candidate = typeof requested === 'string' && requested.trim()
    ? requested.trim()
    : String(req?.session?.user?.username || '').trim();
  if (!candidate || candidate.length > 256 || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw oauthError('PF_AI_CIBA_USER_REQUIRED', 'A user name is required to ask for approval', 400);
  }
  return candidate;
}

function validBindingMessage(requested) {
  if (requested === undefined || requested === null || requested === '') return null;
  if (typeof requested !== 'string' || !BINDING_MESSAGE.test(requested.trim())) {
    throw oauthError('PF_AI_CIBA_BINDING_MESSAGE_INVALID', 'The message must be 1 to 20 letters, digits or . _ + / ! ? # - (no spaces)', 400);
  }
  return requested.trim();
}

// A PingOne session gets PingOne's own CIBA (cibaService, the same one UC22 uses); any other session gets
// PingFederate's. The page and its routes are the same either way.
const providerOf = (req) => (String(req?.session?.oauthProvider || req?.session?.user?.oauthProvider || '')
  .toLowerCase() === 'pingone' ? 'pingone' : 'pingfederate');

const pendingView = (pending) => ({
  state: 'pending',
  provider: pending.provider || 'pingfederate',
  expiresAt: new Date(pending.expiresAt).toISOString(),
  interval: pending.interval,
  loginHint: pending.loginHint,
  bindingMessage: pending.bindingMessage,
});

function finish(featureSession, state, pending, now, extra = {}) {
  delete featureSession.cibaPending;
  const result = {
    state,
    provider: pending?.provider || 'pingfederate',
    loginHint: pending?.loginHint || null,
    bindingMessage: pending?.bindingMessage || null,
    subject: null,
    issuer: null,
    scope: null,
    tokenType: null,
    completedAt: new Date(now()).toISOString(),
    ...extra,
  };
  featureSession.cibaResult = result;
  return result;
}

async function postForm(fetchImpl, url, body, config) {
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthorization(config),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw oauthError('PF_AI_CIBA_UNREACHABLE', 'PingFederate could not be reached');
  }
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}

// Mock phone: no PingFederate call. The pending request waits for mockDecideCiba (the page's
// Approve / Deny buttons), so the page flow runs without a real PingOne MFA device.
// Never on in production, whatever the flag says: it approves a request without any device.
// The web approver (real PingFederate flow) takes precedence over the mock.
const mockEnabled = (store) => process.env.NODE_ENV !== 'production' && !webApproverOn(store)
  && String(store.getEffective('pf_ai_ciba_mock_enabled') || '').trim().toLowerCase() === 'true';

// PingOne CIBA: its login hint is the user's email, and the approval lands on their PingOne MFA device.
async function startPingOneCiba(req, featureSession, { requestedHint, bindingMessage, now }) {
  if (!cibaService.isEnabled()) throw oauthError('PF_AI_CIBA_P1_NOT_CONFIGURED', 'PingOne CIBA is not enabled', 503);
  const hint = String(requestedHint || '').includes('@') ? String(requestedHint).trim() : String(req.session.user?.email || '').trim();
  if (!hint) {
    throw oauthError('PF_AI_CIBA_P1_EMAIL_REQUIRED', 'PingOne CIBA needs the signed-in user\'s email address', 400);
  }
  let result;
  try {
    result = await cibaService.initiateBackchannelAuth(hint, bindingMessage || undefined, 'openid');
  } catch (error) {
    if (error.response?.data?.error === 'unknown_user_id') throw oauthError('PF_AI_CIBA_USER_UNKNOWN', 'PingOne does not know that user', 404);
    throw oauthError('PF_AI_CIBA_REQUEST_FAILED', 'PingOne rejected the approval request');
  }
  const createdAt = now();
  const pending = {
    provider: 'pingone',
    authReqId: result.auth_req_id,
    createdAt,
    expiresAt: createdAt + Math.min(result.expires_in * 1000, MAX_PENDING_MS),
    interval: clampInterval(result.interval),
    lastPolledAt: 0,
    loginHint: hint,
    bindingMessage,
    subject: req.session.user?.id || null,
  };
  featureSession.cibaPending = pending;
  delete featureSession.cibaResult;
  return pendingView(pending);
}

async function pollPingOneCiba(featureSession, pending, now) {
  let tokens;
  try {
    tokens = await cibaService.pollForTokens(pending.authReqId);
  } catch (error) {
    switch (error.response?.data?.error) {
      case 'authorization_pending': return pendingView(pending);
      case 'slow_down':
        pending.interval = clampInterval(pending.interval + SLOW_DOWN_STEP_SECONDS);
        return pendingView(pending);
      case 'access_denied': return finish(featureSession, 'denied', pending, now, { reason: 'user_denied' });
      case 'expired_token': return finish(featureSession, 'expired', pending, now, { reason: 'timed_out' });
      default:
        finish(featureSession, 'error', pending, now, { reason: 'poll_failed' });
        throw oauthError('PF_AI_CIBA_POLL_FAILED', 'PingOne could not complete the approval request');
    }
  }
  let claims;
  try {
    claims = await cibaService.validateCibaIdToken(tokens.id_token, pending.subject);
  } catch {
    finish(featureSession, 'error', pending, now, { reason: 'invalid_token_response' });
    throw oauthError('PF_AI_ID_TOKEN_INVALID', 'PingOne returned an identity result that does not match the user');
  }
  return finish(featureSession, 'approved', pending, now, {
    subject: claims.sub,
    issuer: claims.iss,
    scope: typeof tokens.scope === 'string' ? tokens.scope : null,
    tokenType: typeof tokens.token_type === 'string' ? tokens.token_type : null,
  });
}

async function startCiba(req, {
  loginHint: requestedHint,
  bindingMessage: requestedMessage,
  store = configStore,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!req?.session) throw oauthError('PF_AI_SESSION_REQUIRED', 'An application session is required', 401);
  const provider = providerOf(req);
  // The mock phone and the web approver stand in for a PingFederate-side device; a PingOne session never uses them.
  const mock = provider === 'pingfederate' && mockEnabled(store);
  if (provider === 'pingfederate' && !mock && !getFeatureStatus(store).ciba) {
    throw oauthError('PF_AI_CIBA_NOT_CONFIGURED', 'PF AI Agent CIBA is not enabled or configured', 503);
  }
  req.session.pfAiAgent ||= {};
  const featureSession = req.session.pfAiAgent;
  if (featureSession.cibaPending && featureSession.cibaPending.expiresAt <= now()) delete featureSession.cibaPending;
  if (featureSession.cibaPending) {
    throw oauthError('PF_AI_FLOW_ALREADY_PENDING', 'An approval request is already pending', 409);
  }
  const bindingMessage = validBindingMessage(requestedMessage);
  if (provider === 'pingone') {
    return startPingOneCiba(req, featureSession, { requestedHint, bindingMessage, now });
  }
  const loginHint = sessionLoginHint(req, requestedHint);

  if (mock) {
    const createdAt = now();
    const pending = {
      mock: true,
      createdAt,
      expiresAt: createdAt + MAX_PENDING_MS,
      interval: DEFAULT_INTERVAL_SECONDS,
      lastPolledAt: 0,
      loginHint,
      bindingMessage,
    };
    featureSession.cibaPending = pending;
    delete featureSession.cibaResult;
    return pendingView(pending);
  }
  const config = resolveCibaConfig(store);
  const metadata = await discoverPf(config, fetchImpl);
  if (!metadata.backchannelEndpoint) {
    throw oauthError('PF_AI_CIBA_NOT_SUPPORTED', 'PingFederate does not advertise a CIBA endpoint', 503);
  }
  const body = new URLSearchParams({ scope: 'openid', login_hint: loginHint });
  if (bindingMessage) body.set('binding_message', bindingMessage);
  const response = await postForm(fetchImpl, metadata.backchannelEndpoint, body, config);
  const data = await safeJson(response);
  if (!response?.ok) {
    if (data?.error === 'unknown_user_id') throw oauthError('PF_AI_CIBA_USER_UNKNOWN', 'PingFederate does not know that user', 404);
    if (data?.error === 'invalid_client') throw oauthError('PF_AI_CIBA_CLIENT_REJECTED', 'PingFederate rejected the CIBA client');
    throw oauthError('PF_AI_CIBA_REQUEST_FAILED', 'PingFederate rejected the approval request');
  }
  if (typeof data.auth_req_id !== 'string' || !data.auth_req_id
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw oauthError('PF_AI_CIBA_RESPONSE_INVALID', 'PingFederate returned an invalid approval response');
  }
  const createdAt = now();
  const pending = {
    authReqId: data.auth_req_id,
    createdAt,
    expiresAt: createdAt + Math.min(data.expires_in * 1000, MAX_PENDING_MS),
    interval: clampInterval(data.interval),
    lastPolledAt: 0,
    loginHint,
    bindingMessage,
  };
  featureSession.cibaPending = pending;
  delete featureSession.cibaResult;
  return pendingView(pending);
}

async function pollCiba(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const featureSession = req?.session?.pfAiAgent;
  const pending = featureSession?.cibaPending;
  if (!pending) return featureSession?.cibaResult || { state: 'none' };
  if (pending.expiresAt <= now()) return finish(featureSession, 'expired', pending, now, { reason: 'timed_out' });
  if (pending.mock) return pendingView(pending);
  const isPingOne = pending.provider === 'pingone';
  // The page may ask more often than PingFederate allows; answer from the session instead of calling it.
  if (now() - pending.lastPolledAt < pending.interval * 1000) return pendingView(pending);
  pending.lastPolledAt = now();
  if (isPingOne) return pollPingOneCiba(featureSession, pending, now);

  const config = resolveCibaConfig(store);
  const response = await postForm(fetchImpl, config.tokenEndpoint,
    new URLSearchParams({ grant_type: CIBA_GRANT, auth_req_id: pending.authReqId }), config);
  const data = await safeJson(response);

  if (response?.ok) {
    if (typeof data.id_token !== 'string' || !data.id_token
      || typeof data.access_token !== 'string' || !data.access_token) {
      finish(featureSession, 'error', pending, now, { reason: 'invalid_token_response' });
      throw oauthError('PF_AI_CIBA_RESPONSE_INVALID', 'PingFederate returned an invalid token response');
    }
    const jwksResponse = await fetchImpl(config.jwksUri, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const jwks = await safeJson(jwksResponse);
    // A CIBA ID token has no nonce to match, so compare it with whatever it carries.
    const identity = verifyIdToken(data.id_token, {
      config, metadata: null, clientId: config.clientId, nonce: jwt.decode(data.id_token)?.nonce, jwks,
    });
    return finish(featureSession, 'approved', pending, now, {
      subject: identity.subject,
      issuer: identity.issuer,
      scope: typeof data.scope === 'string' ? data.scope : null,
      tokenType: typeof data.token_type === 'string' ? data.token_type : null,
    });
  }

  switch (data?.error) {
    case 'authorization_pending':
      return pendingView(pending);
    case 'slow_down':
      pending.interval = clampInterval(pending.interval + SLOW_DOWN_STEP_SECONDS);
      return pendingView(pending);
    case 'access_denied':
      return finish(featureSession, 'denied', pending, now, { reason: 'user_denied' });
    case 'expired_token':
      return finish(featureSession, 'expired', pending, now, { reason: 'timed_out' });
    default:
      finish(featureSession, 'error', pending, now, { reason: 'poll_failed' });
      throw oauthError('PF_AI_CIBA_POLL_FAILED', 'PingFederate could not complete the approval request');
  }
}

function mockDecideCiba(req, decision, { store = configStore, now = Date.now } = {}) {
  if (!mockEnabled(store)) throw oauthError('PF_AI_CIBA_MOCK_DISABLED', 'The mock phone is not enabled', 404);
  const featureSession = req?.session?.pfAiAgent;
  const pending = featureSession?.cibaPending;
  if (!pending?.mock) throw oauthError('PF_AI_CIBA_NOTHING_PENDING', 'No mock approval request is pending', 409);
  if (decision === 'approve') {
    return finish(featureSession, 'approved', pending, now, {
      subject: pending.loginHint, issuer: 'mock-phone', scope: 'openid', tokenType: 'none',
    });
  }
  if (decision === 'deny') return finish(featureSession, 'denied', pending, now, { reason: 'user_denied' });
  throw oauthError('PF_AI_CIBA_DECISION_INVALID', 'The decision must be approve or deny', 400);
}

module.exports = {
  CIBA_GRANT,
  mockDecideCiba,
  startCiba,
  pollCiba,
};
