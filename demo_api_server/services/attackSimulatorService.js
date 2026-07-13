'use strict';

/**
 * Attack Simulator Service — A6.1 + A6.2
 *
 * Runs REAL deficient-token attacks against the live MCP gateway.
 * No local signing. The token PingOne mints is structurally valid;
 * the deficiency is in the claim values (wrong scope, wrong aud, cross-owner
 * resource, rogue actor, RAR overage, tampered intent, missing act, replay).
 *
 * Gateway error contract (from mcpGatewayClient.js):
 *   - 401 wrong-aud → throws { code: 'GATEWAY_AUDIENCE_MISMATCH', httpStatus: 401, message }
 *   - scope denial (MCP server, HTTP 200 RPC error) → throws { code: 'mcp_tool_error', httpStatus: 200, rpcCode }
 *   - scope denial (gateway 403) → throws { code: 'gateway_policy_denied', httpStatus: 403 }
 *   - callToolViaGateway(null, ...) self-resolves the gateway URL via getMcpGatewayHttpUrl()
 */

const oauthService = require('./oauthService');
const { callToolViaGateway, getMcpGatewayHttpUrl } = require('./mcpGatewayClient');
const { buildTokenEvent, decodeJwtClaims, buildTratContext, buildRarAuthorizationDetails } = require('./agentMcpTokenService');
const { mintIntentToken } = require('./intentTokenService');
const dataStore = require('../data/store');
const configStore = require('./configStore');
const { stampUseCaseId } = require('./useCaseTagging');

const UC18_DEMO_RATE_LIMIT = {
  rateLimitEnabled: true,
  rateLimitMaxRequests: 3,
  rateLimitWindowMs: 10000,
};

/** Catalog slug per sim id (useCases.js useCaseId fields). */
const SIM_USE_CASE_IDS = {
  'insufficient-scope': 'insufficient-scope',
  'wrong-aud': 'bad-client-gateway',
  'cross-owner-account': 'cross-owner-account',
  'replayed-token': 'token-theft-replay',
  'rogue-actor': 'confused-deputy-actor-injection',
  'rar-exceeded': 'rar-intent-violation',
  'tampered-intent-token': 'intent-token-tampering',
  'impersonation-no-act': 'impersonation-blocked',
  'rate-limit-burst': 'rate-limit-defense',
};

/** Confused-deputy showcase rogue actor (parity with AIAgent.js + decision.confused-deputy.test.js). */
const ROGUE_ACTOR_CLIENT_ID = 'rogue-agent-9f2a-not-allowlisted';

/** Sample-data account owned by user id "2" (not the demo customer). */
const FOREIGN_ACCOUNT_ID = '3';

/**
 * Resolve the gateway resource URI — the audience the gateway expects.
 * @returns {string}
 */
function _gatewayAud() {
  return (
    configStore.getEffective('pingone_resource_mcp_gateway_uri') ||
    process.env.MCP_GW_RESOURCE_URI ||
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI ||
    ''
  );
}

/**
 * Resolve a "wrong" audience — a real PingOne resource URI that is NOT
 * the gateway's expected audience. Used for the wrong-aud sim.
 * @returns {string}
 */
function _wrongAud() {
  // Prefer the MCP server URI (the upstream hop beyond the gateway), then
  // the MCP invest URI if configured, then the agent gateway URI.
  // Any real audience that differs from the gateway audience will cause
  // validateInboundToken to emit invalid_aud.
  return (
    configStore.getEffective('pingone_resource_mcp_server_uri') ||
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI ||
    configStore.getEffective('pingone_resource_agent_gateway_uri') ||
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI ||
    ''
  );
}

/**
 * RFC 8693 token exchange for the attack sims, authenticated AS the MCP Exchanger
 * app — the SAME mechanism the real chip flow uses (see agentMcpTokenService.js
 * variant selection). The exchanger app is granted the MCP Gateway scopes by the
 * two-exchange reconciler (condition 4), so PingOne binds the minted token's `aud`
 * to the requested gateway/resource audience. Plain performTokenExchange (default
 * app) instead mints for the scope-owning API resource (enduser.ping.demo), whose
 * aud BOTH gateways reject — masking every sim's real control behind an audience
 * failure. Falling back to the plain exchange only when the exchanger is
 * unconfigured keeps dev parity. Keep this selection in sync with
 * agentMcpTokenService.js (guarded by attackSimAudience parity test).
 *
 * @param {string} subjectToken - the user access token to exchange
 * @param {string} audience - target resource audience (gateway or a deliberately-wrong one)
 * @param {string[]} scopes - requested scopes
 * @returns {Promise<string>} exchanged access token
 */
async function _exchangeSimToken(subjectToken, audience, scopes) {
  const exchangerId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
  const exchangerCred = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
  if (exchangerId && exchangerCred) {
    const method = (
      process.env.PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD ||
      process.env.PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD ||
      'post'
    ).toLowerCase();
    return oauthService.performTokenExchangeAs(
      subjectToken, null, exchangerId, exchangerCred, audience, scopes, method,
    );
  }
  return oauthService.performTokenExchange(subjectToken, audience, scopes);
}

/**
 * Parse the gateway error from an error thrown by callToolViaGateway.
 *
 * callToolViaGateway throws errors with ONLY .code + .httpStatus + .message
 * (no .body / .wwwAuth / .response.data — those fields do not exist on the
 * thrown error object). Map the internal gateway codes to canonical sim codes:
 *   'GATEWAY_AUDIENCE_MISMATCH' → 'invalid_aud'
 *   'mcp_tool_error' (httpStatus 200, scope deny from MCP server) → 'insufficient_scope'
 *   'gateway_policy_denied' (403 from gateway) → 'insufficient_scope'
 *
 * @param {object} err - Error thrown by callToolViaGateway (.code, .httpStatus, .message)
 * @param {number} fallbackStatus - HTTP status to use if not on the error
 * @returns {{ errorCode: string, httpStatus: number, reason: string }}
 */
function _parseGatewayError(err, fallbackStatus) {
  const httpStatus = err.httpStatus || fallbackStatus;
  const errorCode = err.code || 'gateway_error';
  const reason = err.message || `Gateway rejected the request (HTTP ${httpStatus})`;
  return { errorCode, httpStatus, reason };
}

/**
 * Resolve catalog useCaseId slug for a sim id.
 * @param {string} sim
 * @returns {string}
 */
function _useCaseIdForSim(sim) {
  return SIM_USE_CASE_IDS[sim] || sim;
}

/**
 * Push runtime gateway flags for UC14/15/16 demo arming (Demo Agent Gateway only).
 * @param {Record<string, boolean>} flags
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function _pushGatewayFlags(flags) {
  if (configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true') {
    return { ok: true };
  }
  let gatewayUrl;
  try {
    gatewayUrl = getMcpGatewayHttpUrl();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const { pushGatewayAdminConfig } = require('../routes/mcpGatewayConfig');
  return pushGatewayAdminConfig(gatewayUrl, flags);
}

/**
 * Exchange the session token to the gateway audience and record token-chain events.
 * @returns {Promise<{ ok: true, token: string } | { ok: false, result: object }>}
 */
async function _exchangeGatewayToken(subjectToken, scopes, useCaseId, tokenChainEvents, label) {
  const gatewayAud = _gatewayAud();
  if (!gatewayAud) {
    return {
      ok: false,
      result: {
        sim: label,
        useCaseId,
        status: 503,
        errorCode: 'gateway_not_configured',
        reason: 'pingone_resource_mcp_gateway_uri is not configured',
        tokenChainEvents,
      },
    };
  }

  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-start',
    `Token Exchange (${label})`,
    'active',
    null,
    `Exchanging user token to gateway audience ${gatewayAud} with scope "${scopes.join(' ')}".`,
  ));

  let exchangedToken;
  try {
    exchangedToken = await _exchangeSimToken(subjectToken, gatewayAud, scopes);
  } catch (err) {
    const errorCode = err.pingoneError || 'exchange_failed';
    const reason = `Token exchange failed: ${err.message}`;
    tokenChainEvents.push(buildTokenEvent(
      'sim-exchange-error',
      'Token Exchange FAILED',
      'error',
      null,
      reason,
      { error: errorCode },
    ));
    return {
      ok: false,
      result: {
        sim: label,
        useCaseId,
        status: 502,
        errorCode,
        reason,
        tokenChainEvents,
      },
    };
  }

  const decoded = decodeJwtClaims(exchangedToken);
  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-ok',
    'Exchanged Token',
    'active',
    decoded,
    'PingOne minted a delegated gateway token for the attack scenario.',
    { exchangeDetails: { audience: gatewayAud, scopes: scopes.join(' ') } },
  ));
  return { ok: true, token: exchangedToken };
}

/**
 * Build a deny result from a gateway error with optional canonical error code.
 */
function _denyFromGateway(sim, useCaseId, tokenChainEvents, err, fallbackStatus, canonicalCode, eventLabel) {
  const { errorCode: rawCode, httpStatus: rawStatus, reason } = _parseGatewayError(err, fallbackStatus);
  const errorCode = canonicalCode || rawCode;
  const httpStatus = canonicalCode ? fallbackStatus : rawStatus;
  tokenChainEvents.push(buildTokenEvent(
    'sim-gateway-deny',
    eventLabel || `Gateway DENY (${errorCode})`,
    'error',
    null,
    `Gateway rejected the call with ${httpStatus} ${errorCode}: ${reason}`,
    { error: errorCode, httpStatus },
  ));
  stampUseCaseId(tokenChainEvents, useCaseId);
  return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
}

/**
 * Run an attack simulation against the real gateway with a real-deficient token.
 *
 * @param {string} sim - The attack sim id ('insufficient-scope' or 'wrong-aud')
 * @param {object} req - Express request (for session + useCaseId)
 * @param {number} [attackAmount] - Optional override for the rar-exceeded attack
 *   amount (Intent Binding demo's 'drift' column). Ignored by every other sim.
 *   When omitted, _runRarExceeded falls back to its default of 500 — so the
 *   UC14 attack-sim entry point (routes/attackSimulator.js, which never passes
 *   this arg) is unaffected.
 * @returns {Promise<{sim, status, errorCode, reason, tokenChainEvents, useCaseId}>}
 */
async function runAttackSim(sim, req, attackAmount) {
  const subjectToken = req?.session?.oauthTokens?.accessToken;
  if (!subjectToken) {
    return {
      sim,
      status: 401,
      errorCode: 'no_session_token',
      reason: 'No access token in session — user must be logged in',
      tokenChainEvents: [],
      useCaseId: null,
    };
  }

  // Catalog slugs (useCases.js useCaseId per sim)
  const useCaseId = _useCaseIdForSim(sim);
  const tokenChainEvents = [];

  if (sim === 'insufficient-scope') {
    return _runInsufficientScope(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'wrong-aud') {
    return _runWrongAud(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'rate-limit-burst') {
    return _runRateLimitBurst(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'cross-owner-account') {
    return _runCrossOwnerAccount(subjectToken, useCaseId, tokenChainEvents, req);
  }

  if (sim === 'replayed-token') {
    return _runReplayedToken(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'rogue-actor') {
    return _runRogueActor(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'rar-exceeded') {
    return _runRarExceeded(subjectToken, useCaseId, tokenChainEvents, req, attackAmount);
  }

  if (sim === 'tampered-intent-token') {
    return _runTamperedIntentToken(subjectToken, useCaseId, tokenChainEvents, req);
  }

  if (sim === 'impersonation-no-act') {
    return _runImpersonationNoAct(subjectToken, useCaseId, tokenChainEvents);
  }

  // Should not be reached — route validates VALID_SIMS before calling here.
  return {
    sim,
    status: 400,
    errorCode: 'unknown_sim',
    reason: `Unknown sim: ${sim}`,
    tokenChainEvents: [],
    useCaseId: null,
  };
}

/**
 * insufficient-scope sim:
 *   Exchange subject token to the REAL gateway audience requesting only ['read'].
 *   Then call create_transfer — which requires 'write'.
 *   The gateway's scope check returns 403 insufficient_scope.
 */
async function _runInsufficientScope(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'insufficient-scope';
  const gatewayAud = _gatewayAud();

  if (!gatewayAud) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'gateway_not_configured',
      reason: 'pingone_resource_mcp_gateway_uri is not configured',
      tokenChainEvents,
    };
  }

  // Step 1: exchange to gateway audience with only 'read' scope
  let exchangedToken;
  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-start',
    'Token Exchange (read-only, sim)',
    'active',
    null,
    `Exchanging user token to gateway audience ${gatewayAud} with scope "read" only. ` +
    'The intent is to hold a valid token that lacks the write scope create_transfer needs.'
  ));

  try {
    exchangedToken = await _exchangeSimToken(
      subjectToken,
      gatewayAud,
      ['read']
    );
  } catch (err) {
    const errorCode = err.pingoneError || 'exchange_failed';
    const reason = `Token exchange failed: ${err.message}`;
    tokenChainEvents.push(buildTokenEvent(
      'sim-exchange-error',
      'Token Exchange FAILED',
      'error',
      null,
      reason,
      { error: errorCode }
    ));
    return { sim, useCaseId, status: 502, errorCode, reason, tokenChainEvents };
  }

  const decoded = decodeJwtClaims(exchangedToken);
  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-ok',
    'Exchanged Token (read-only)',
    'active',
    decoded,
    'PingOne minted a valid token scoped to "read" only. ' +
    'This token will be rejected when it tries to call a write-scoped tool.',
    { exchangeDetails: { audience: gatewayAud, scopes: 'read' } }
  ));

  // Step 2: call create_transfer (requires write) — expect scope denial.
  // Scope enforcement is at the MCP server (downstream of the gateway).
  // callToolViaGateway surfaces it as a thrown error with:
  //   code: 'mcp_tool_error' + httpStatus: 200  (JSON-RPC error in 200 response)
  //   code: 'gateway_policy_denied' + httpStatus: 403  (gateway-layer 403)
  // Both are canonicalized to the sim's reason-distinct code 'insufficient_scope'.
  try {
    await callToolViaGateway(
      null,
      exchangedToken,
      'create_transfer',
      { amount: 1, toAccountId: 'sim-acc-001' }
    );
    // If no error thrown, scope enforcement did not fire — unexpected permit.
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted a write-scoped tool call with a read-only token. Scope enforcement may not be active.'
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId,
      status: 200,
      errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — scope enforcement may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    const { errorCode: rawCode, httpStatus: rawStatus, reason } = _parseGatewayError(err, 403);
    // Canonicalize: mcp_tool_error (HTTP 200) and gateway_policy_denied (HTTP 403) both
    // represent a scope denial in this sim. Report as 'insufficient_scope' with 403.
    const isScopeDeny = rawCode === 'mcp_tool_error' || rawCode === 'gateway_policy_denied';
    const errorCode = isScopeDeny ? 'insufficient_scope' : rawCode;
    const httpStatus = isScopeDeny ? 403 : rawStatus;
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-deny',
      'Gateway DENY (insufficient_scope)',
      'error',
      null,
      `Gateway rejected the call with ${httpStatus} ${errorCode}: ${reason}`,
      { error: errorCode, httpStatus }
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
  }
}

/**
 * wrong-aud sim:
 *   Exchange subject token to a DIFFERENT real audience (not the gateway's expected aud).
 *   Then call get_accounts at the gateway.
 *   The gateway's validateInboundToken sees aud != gatewayResourceUri → 401 invalid_aud.
 */
async function _runWrongAud(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'wrong-aud';
  const gatewayAud = _gatewayAud();
  const wrongAud = _wrongAud();

  if (!gatewayAud) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'gateway_not_configured',
      reason: 'pingone_resource_mcp_gateway_uri is not configured',
      tokenChainEvents,
    };
  }

  if (!wrongAud || wrongAud === gatewayAud) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'wrong_aud_not_configured',
      reason: 'No distinct wrong audience is configured — set PINGONE_RESOURCE_MCP_SERVER_URI or PINGONE_RESOURCE_AGENT_GATEWAY_URI',
      tokenChainEvents,
    };
  }

  // Step 1: exchange to a WRONG real audience
  let exchangedToken;
  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-start',
    'Token Exchange (wrong audience, sim)',
    'active',
    null,
    `Exchanging user token to audience ${wrongAud} instead of the gateway's expected audience ${gatewayAud}. ` +
    'PingOne will issue a valid token, but its aud claim will not match what the gateway expects.'
  ));

  try {
    exchangedToken = await oauthService.performTokenExchange(
      subjectToken,
      wrongAud,
      ['read', 'write']
    );
  } catch (err) {
    const errorCode = err.pingoneError || 'exchange_failed';
    const reason = `Token exchange to wrong audience failed: ${err.message}`;
    tokenChainEvents.push(buildTokenEvent(
      'sim-exchange-error',
      'Token Exchange FAILED',
      'error',
      null,
      reason,
      { error: errorCode }
    ));
    return { sim, useCaseId, status: 502, errorCode, reason, tokenChainEvents };
  }

  const decoded = decodeJwtClaims(exchangedToken);
  tokenChainEvents.push(buildTokenEvent(
    'sim-exchange-ok',
    'Exchanged Token (wrong audience)',
    'active',
    decoded,
    `PingOne issued a valid token with aud="${wrongAud}". ` +
    `The gateway expects aud="${gatewayAud}" — this token will be rejected.`,
    { exchangeDetails: { audience: wrongAud, scopes: 'read write' } }
  ));

  // Step 2: present the wrong-aud token to the gateway — expect 401 GATEWAY_AUDIENCE_MISMATCH.
  // callToolViaGateway throws { code: 'GATEWAY_AUDIENCE_MISMATCH', httpStatus: 401 }
  // when the inbound token's aud does not match the gateway's expected resource URI.
  // Canonicalize to 'invalid_aud' for reason-distinct reporting.
  try {
    await callToolViaGateway(
      null,
      exchangedToken,
      'get_accounts',
      {}
    );
    // Unexpected permit
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted a call with a wrong-audience token. Audience validation may not be active.'
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId,
      status: 200,
      errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — audience validation may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    const { errorCode: rawCode, httpStatus, reason } = _parseGatewayError(err, 401);
    // Canonicalize: GATEWAY_AUDIENCE_MISMATCH → 'invalid_aud' (canonical sim code)
    const errorCode = rawCode === 'GATEWAY_AUDIENCE_MISMATCH' ? 'invalid_aud' : rawCode;
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-deny',
      'Gateway DENY (invalid_aud)',
      'error',
      null,
      `Gateway rejected the token with ${httpStatus} ${errorCode}: ${reason}`,
      { error: errorCode, httpStatus }
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
  }
}

/**
 * rate-limit-burst sim (UC18):
 *   Enable demo rate limits on the Demo Agent Gateway, exchange a valid token,
 *   then fire a burst of read-only tool calls until the gateway returns 429.
 */
async function _runRateLimitBurst(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'rate-limit-burst';
  const gatewayAud = _gatewayAud();
  const usePing = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';

  if (!gatewayAud) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'gateway_not_configured',
      reason: 'pingone_resource_mcp_gateway_uri is not configured',
      tokenChainEvents,
    };
  }

  try {
    await configStore.setRaw({ ff_mcp_rate_limit: 'true' });
  } catch (err) {
    return {
      sim, useCaseId,
      status: 500,
      errorCode: 'config_store_failed',
      reason: err.message,
      tokenChainEvents,
    };
  }

  if (usePing) {
    const { getBffRateLimitConfig } = require('./mcpGatewayRateLimit');
    const bffCfg = getBffRateLimitConfig();
    tokenChainEvents.push(buildTokenEvent(
      'sim-rate-limit-armed',
      'BFF edge rate limit armed (UC18 / PingOne IG)',
      'active',
      null,
      `BFF throttles before IG/P1AZ: max ${bffCfg.maxRequests} calls per ` +
      `${bffCfg.windowMs}ms per (agent, tool) key.`,
    ));
  } else {
    let gatewayUrl;
    try {
      gatewayUrl = getMcpGatewayHttpUrl();
    } catch (err) {
      return {
        sim, useCaseId,
        status: 503,
        errorCode: 'gateway_not_configured',
        reason: err.message,
        tokenChainEvents,
      };
    }

    const { pushGatewayAdminConfig } = require('../routes/mcpGatewayConfig');
    const pushResult = await pushGatewayAdminConfig(gatewayUrl, UC18_DEMO_RATE_LIMIT);
    if (!pushResult.ok) {
      return {
        sim, useCaseId,
        status: 502,
        errorCode: 'gateway_push_failed',
        reason: pushResult.error || 'Could not enable rate limiting on gateway',
        tokenChainEvents,
      };
    }

    tokenChainEvents.push(buildTokenEvent(
      'sim-rate-limit-armed',
      'Gateway rate limit armed (UC18)',
      'active',
      null,
      `Pushed demo limits to gateway: max ${UC18_DEMO_RATE_LIMIT.rateLimitMaxRequests} calls per ` +
      `${UC18_DEMO_RATE_LIMIT.rateLimitWindowMs}ms per (agent, tool) key.`,
    ));
  }

  let exchangedToken;
  try {
    exchangedToken = await _exchangeSimToken(
      subjectToken,
      gatewayAud,
      ['read'],
    );
  } catch (err) {
    const errorCode = err.pingoneError || 'exchange_failed';
    return {
      sim, useCaseId,
      status: 502,
      errorCode,
      reason: `Token exchange failed: ${err.message}`,
      tokenChainEvents,
    };
  }

  const burstCount = 5;
  let rateLimitedHit = null;

  for (let i = 0; i < burstCount; i++) {
    try {
      await callToolViaGateway(null, exchangedToken, 'get_my_accounts', {});
      tokenChainEvents.push(buildTokenEvent(
        `sim-burst-${i + 1}`,
        `Burst call ${i + 1} PERMIT`,
        'active',
        null,
        `Call ${i + 1} of ${burstCount} succeeded.`,
      ));
    } catch (err) {
      const { errorCode, httpStatus, reason } = _parseGatewayError(err, 429);
      if (errorCode === 'rate_limited' || httpStatus === 429) {
        rateLimitedHit = { errorCode: 'rate_limited', httpStatus: 429, reason };
        tokenChainEvents.push(buildTokenEvent(
          `sim-burst-${i + 1}`,
          `Burst call ${i + 1} RATE LIMITED (429)`,
          'error',
          null,
          reason,
          { error: 'rate_limited', httpStatus: 429, retryAfterMs: err.retryAfterMs || null },
        ));
        break;
      }
      tokenChainEvents.push(buildTokenEvent(
        `sim-burst-${i + 1}`,
        `Burst call ${i + 1} ERROR`,
        'error',
        null,
        reason,
        { error: errorCode, httpStatus },
      ));
      stampUseCaseId(tokenChainEvents, useCaseId);
      return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
    }
  }

  stampUseCaseId(tokenChainEvents, useCaseId);

  if (rateLimitedHit) {
    return {
      sim,
      useCaseId,
      status: 429,
      errorCode: 'rate_limited',
      reason: rateLimitedHit.reason,
      tokenChainEvents,
    };
  }

  return {
    sim,
    useCaseId,
    status: 200,
    errorCode: 'unexpected_permit',
    reason: 'Burst completed without a 429 — rate limiting may not be active on the gateway',
    tokenChainEvents,
  };
}

/**
 * UC10 cross-owner-account: read another user's account with a valid delegated token.
 */
async function _runCrossOwnerAccount(subjectToken, useCaseId, tokenChainEvents, req) {
  const sim = 'cross-owner-account';
  const exchanged = await _exchangeGatewayToken(subjectToken, ['read'], useCaseId, tokenChainEvents, sim);
  if (!exchanged.ok) return exchanged.result;

  const foreign = dataStore.getAccountById(FOREIGN_ACCOUNT_ID);
  const foreignOwner = foreign?.userId || 'another user';
  tokenChainEvents.push(buildTokenEvent(
    'sim-attack-setup',
    'Cross-owner target selected',
    'active',
    null,
    `Attempting get_account_balance for account ${FOREIGN_ACCOUNT_ID} owned by user "${foreignOwner}" ` +
    `while authenticated as "${req?.session?.user?.sub || req?.user?.sub || 'current user'}".`,
  ));

  try {
    await callToolViaGateway(null, exchanged.token, 'get_account_balance', { account_id: FOREIGN_ACCOUNT_ID });
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted a cross-owner balance read — resource-ownership enforcement may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — resource-ownership enforcement may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 403, 'resource_owner_mismatch',
      'Gateway DENY (resource_owner_mismatch)',
    );
  }
}

/**
 * UC12 replayed-token: present the BFF/session token (wrong audience) directly to the gateway.
 */
async function _runReplayedToken(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'replayed-token';
  const gatewayAud = _gatewayAud();
  const decoded = decodeJwtClaims(subjectToken);

  tokenChainEvents.push(buildTokenEvent(
    'sim-replay-start',
    'Replay stolen session token (wrong audience)',
    'active',
    decoded,
    `Presenting the user's session token directly to the gateway without RFC 8693 exchange. ` +
    `Audience binding requires aud="${gatewayAud}" — a token minted for the BFF/API audience must be rejected.`,
  ));

  try {
    await callToolViaGateway(null, subjectToken, 'get_my_accounts', {});
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway accepted a replayed session token — audience binding may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — audience binding may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    return _denyFromGateway(sim, useCaseId, tokenChainEvents, err, 401, 'invalid_aud', 'Gateway DENY (invalid_aud)');
  }
}

/**
 * UC13 rogue-actor: inject a non-allowlisted ActClientId (confused-deputy pattern).
 */
async function _runRogueActor(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'rogue-actor';
  const exchanged = await _exchangeGatewayToken(subjectToken, ['read', 'write'], useCaseId, tokenChainEvents, sim);
  if (!exchanged.ok) return exchanged.result;

  tokenChainEvents.push(buildTokenEvent(
    'sim-rogue-actor',
    'Rogue actor injected into act chain',
    'active',
    null,
    `Overriding X-Act-Client-Id with rogue actor "${ROGUE_ACTOR_CLIENT_ID}" — ` +
    'Authorize must DENY via HasValidActorChain.',
  ));

  try {
    await callToolViaGateway(null, exchanged.token, 'get_my_accounts', {}, {
      testActClientId: ROGUE_ACTOR_CLIENT_ID,
    });
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted a rogue actor — authorized-actor enforcement may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — authorized-actor enforcement may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 403, 'mcp_invalid_actor',
      'Gateway DENY (mcp_invalid_actor)',
    );
  }
}

/**
 * UC14 rar-exceeded: TraT/RAR grants $100 but the agent attempts a larger transfer.
 *
 * @param {number} [attackAmount] - Amount to attempt in the create_transfer call.
 *   Defaults to 500 (the original UC14 hardcoded value) when not a finite positive
 *   number — this is what keeps routes/attackSimulator.js's existing callers
 *   (which never pass this arg) behaving exactly as before.
 */
async function _runRarExceeded(subjectToken, useCaseId, tokenChainEvents, req, attackAmount) {
  const sim = 'rar-exceeded';
  const grantedAmount = 100;
  const finalAttackAmount = Number.isFinite(attackAmount) && attackAmount > 0 ? attackAmount : 500;

  try {
    await configStore.setRaw({ ff_rar: 'true' });
  } catch (err) {
    return { sim, useCaseId, status: 500, errorCode: 'config_store_failed', reason: err.message, tokenChainEvents };
  }

  const pushResult = await _pushGatewayFlags({ requireRarIntent: true });
  if (!pushResult.ok) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-arm-failed',
      'Gateway RAR arm failed (non-fatal)',
      'warning',
      null,
      pushResult.error || 'Could not arm requireRarIntent on gateway',
    ));
  } else {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-armed',
      'Gateway RAR enforcement armed (UC14)',
      'active',
      null,
      'requireRarIntent enabled on Demo Agent Gateway for this burst.',
    ));
  }

  const exchanged = await _exchangeGatewayToken(
    subjectToken, ['read', 'write', 'transfer'], useCaseId, tokenChainEvents, sim,
  );
  if (!exchanged.ok) return exchanged.result;

  const userSub = req?.session?.user?.sub || req?.user?.sub || '';
  const rarDetails = buildRarAuthorizationDetails(
    'create_transfer',
    { amount: grantedAmount, to_account_id: 'sim-acc-001' },
    userSub,
  );
  const tratCtx = buildTratContext(
    req,
    'create_transfer',
    userSub,
    configStore.getEffective('pingone_ai_agent_actor_client_id') || '',
    configStore.getEffective('admin_client_id') || '',
    { rarDetails },
  );
  const tratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: true });

  tokenChainEvents.push(buildTokenEvent(
    'sim-rar-grant',
    `RAR grant ($${grantedAmount})`,
    'active',
    null,
    `Attested authorization_details cap the transfer at $${grantedAmount}. ` +
    `Attack attempts create_transfer for $${finalAttackAmount}.`,
    { authorization_details: rarDetails },
  ));

  try {
    await callToolViaGateway(
      null,
      exchanged.token,
      'create_transfer',
      { amount: finalAttackAmount, to_account_id: 'sim-acc-001' },
      { tratContextHeader },
    );
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted a RAR-overlimit transfer — RAR enforcement may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — RAR enforcement may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 403, 'rar_amount_exceeded',
      'Gateway DENY (rar_amount_exceeded)',
    );
  }
}

/**
 * Intent Binding demo (PERMIT path): mints the same $100 RAR grant UC14's
 * attack path denies, but requests a transfer within the granted cap. The
 * gateway/authz PERMIT and the response carries an 'intent-binding-verified'
 * token event — the legitimate counterpart to UC14's DENY.
 */
async function _runRarPermit(subjectToken, useCaseId, tokenChainEvents, req, requestedAmount) {
  const sim = 'rar-permit';
  const grantedAmount = 100;
  const amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : grantedAmount;

  try {
    await configStore.setRaw({ ff_rar: 'true' });
  } catch (err) {
    return { sim, useCaseId, status: 500, errorCode: 'config_store_failed', reason: err.message, tokenChainEvents };
  }

  const pushResult = await _pushGatewayFlags({ requireRarIntent: true });
  if (!pushResult.ok) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-arm-failed',
      'Gateway RAR arm failed (non-fatal)',
      'warning',
      null,
      pushResult.error || 'Could not arm requireRarIntent on gateway',
    ));
  } else {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-armed',
      'Gateway RAR enforcement armed (Intent Binding demo)',
      'active',
      null,
      'requireRarIntent enabled on Demo Agent Gateway for this call.',
    ));
  }

  const exchanged = await _exchangeGatewayToken(
    subjectToken, ['read', 'write', 'transfer'], useCaseId, tokenChainEvents, sim,
  );
  if (!exchanged.ok) return exchanged.result;

  const userSub = req?.session?.user?.sub || req?.user?.sub || '';
  const rarDetails = buildRarAuthorizationDetails(
    'create_transfer',
    { amount: grantedAmount, to_account_id: 'sim-acc-001' },
    userSub,
  );
  const tratCtx = buildTratContext(
    req,
    'create_transfer',
    userSub,
    configStore.getEffective('pingone_ai_agent_actor_client_id') || '',
    configStore.getEffective('admin_client_id') || '',
    { rarDetails },
  );
  const tratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: true });

  tokenChainEvents.push(buildTokenEvent(
    'sim-rar-grant',
    `RAR grant ($${grantedAmount})`,
    'active',
    null,
    `Attested authorization_details cap the transfer at $${grantedAmount}. ` +
    `This call requests $${amount}, within the granted cap.`,
    { authorization_details: rarDetails },
  ));

  try {
    await callToolViaGateway(
      null,
      exchanged.token,
      'create_transfer',
      { amount, to_account_id: 'sim-acc-001' },
      { tratContextHeader },
    );
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 403, 'rar_unexpected_deny',
      'Gateway DENY (unexpected — requested amount was within the granted cap)',
    );
  }

  tokenChainEvents.push(buildTokenEvent(
    'intent-binding-verified',
    'Intent Verified (RAR — RFC 9396)',
    'active',
    null,
    `Gateway PERMIT: requested $${amount} is within the RAR authorization_details cap of $${grantedAmount}. ` +
    'The MCP gateway and PingOne Authorize confirmed the transfer matches the declared intent.',
    { authorization_details: rarDetails, requestedAmount: amount, grantedAmount },
  ));
  _stampUseCaseId(tokenChainEvents, useCaseId);
  return { sim, useCaseId, status: 200, errorCode: null, reason: 'PERMIT — within granted RAR cap', tokenChainEvents };
}

/**
 * Public entry point for the Intent Binding learning-page demo. 'drift' reuses
 * the existing UC14 attack path unchanged (it already demonstrates the DENY
 * side); 'permit' is the new legitimate counterpart above.
 */
async function runIntentBindingDemo(action, req, requestedAmount) {
  if (action === 'drift') {
    return runAttackSim('rar-exceeded', req, requestedAmount);
  }
  if (action !== 'permit') {
    return {
      sim: null, useCaseId: null, status: 400, errorCode: 'unknown_action',
      reason: `Unknown action: ${action}`, tokenChainEvents: [],
    };
  }
  const subjectToken = req?.session?.oauthTokens?.accessToken;
  if (!subjectToken) {
    return {
      sim: 'rar-permit', useCaseId: null, status: 401, errorCode: 'no_session_token',
      reason: 'No access token in session — user must be logged in', tokenChainEvents: [],
    };
  }
  const useCaseId = 'rar-intent-verified';
  const tokenChainEvents = [];
  return _runRarPermit(subjectToken, useCaseId, tokenChainEvents, req, requestedAmount);
}

/**
 * UC15 tampered-intent-token: valid intent JWT with a corrupted signature.
 */
async function _runTamperedIntentToken(subjectToken, useCaseId, tokenChainEvents, req) {
  const sim = 'tampered-intent-token';
  const userSub = req?.session?.user?.sub || req?.user?.sub || '';

  const pushResult = await _pushGatewayFlags({ intentTokenRequired: true });
  if (!pushResult.ok) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-intent-arm-failed',
      'Gateway intent-token arm failed (non-fatal)',
      'warning',
      null,
      pushResult.error || 'Could not arm intentTokenRequired on gateway',
    ));
  } else {
    tokenChainEvents.push(buildTokenEvent(
      'sim-intent-armed',
      'Gateway intent-token validation armed (UC15)',
      'active',
      null,
      'intentTokenRequired enabled — tampered X-Intent-Token must be rejected.',
    ));
  }

  const exchanged = await _exchangeGatewayToken(subjectToken, ['read'], useCaseId, tokenChainEvents, sim);
  if (!exchanged.ok) return exchanged.result;

  const { token: intentToken } = mintIntentToken({
    userId: userSub,
    sessionId: req?.sessionID || '',
    prompt: 'show my accounts',
    intent: 'view_accounts',
    confidence: 0.95,
    vertical: 'banking',
  });
  const parts = intentToken.split('.');
  const tamperedIntent = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;

  tokenChainEvents.push(buildTokenEvent(
    'sim-intent-tamper',
    'Intent token tampered (signature corrupt)',
    'active',
    null,
    'Minted a valid intent token then flipped the HMAC signature — gateway must reject before Authorize.',
  ));

  try {
    await callToolViaGateway(null, exchanged.token, 'get_my_accounts', {}, { intentToken: tamperedIntent });
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway accepted a tampered intent token — signature validation may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — intent-token validation may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    const canonical = err.gatewayErrorCode === 'intent_token_invalid' ? 'intent_token_invalid' : 'invalid_signature';
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 401, canonical,
      'Gateway DENY (intent_token_invalid)',
    );
  }
}

/**
 * UC16 impersonation-no-act: gateway token without act claim on an agent-mediated tool.
 */
async function _runImpersonationNoAct(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'impersonation-no-act';

  const pushResult = await _pushGatewayFlags({ requireActForAgentTools: true });
  if (!pushResult.ok) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-act-arm-failed',
      'Gateway UC16 arm failed (non-fatal)',
      'warning',
      null,
      pushResult.error || 'Could not arm requireActForAgentTools on gateway',
    ));
  } else {
    tokenChainEvents.push(buildTokenEvent(
      'sim-act-armed',
      'Impersonation block armed (UC16)',
      'active',
      null,
      'requireActForAgentTools enabled — agent-mediated tools require an act claim.',
    ));
  }

  const exchanged = await _exchangeGatewayToken(
    subjectToken, ['read', 'write', 'transfer'], useCaseId, tokenChainEvents, sim,
  );
  if (!exchanged.ok) return exchanged.result;

  const decoded = decodeJwtClaims(exchanged.token);
  if (decoded?.claims?.act) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-act-present',
      'Exchanged token carries act (unexpected for impersonation sim)',
      'warning',
      decoded,
      'PingOne included an act claim on the exchanged token — UC16 may not fire unless REQUIRE_ACT is enforced upstream.',
    ));
  }

  try {
    await callToolViaGateway(null, exchanged.token, 'create_transfer', {
      amount: 1,
      to_account_id: 'sim-acc-001',
    });
    tokenChainEvents.push(buildTokenEvent(
      'sim-gateway-unexpected-permit',
      'Gateway PERMIT (unexpected)',
      'warning',
      null,
      'The gateway permitted an act-less impersonation call — UC16 enforcement may not be active.',
    ));
    stampUseCaseId(tokenChainEvents, useCaseId);
    return {
      sim, useCaseId, status: 200, errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — impersonation block may not be active',
      tokenChainEvents,
    };
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 401, 'missing_act',
      'Gateway DENY (missing_act)',
    );
  }
}

module.exports = { runAttackSim, runIntentBindingDemo, _exchangeSimToken };
