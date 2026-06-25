'use strict';

/**
 * Attack Simulator Service — A6.1
 *
 * Runs REAL deficient-token attacks against the live MCP gateway.
 * No local signing. The token PingOne mints is structurally valid;
 * the deficiency is in the claim values (wrong scope or wrong aud).
 *
 * A6.2 (crafted/forged tokens) is deferred until Plan C phase C4 lands.
 *
 * Gateway error contract (from mcpGatewayClient.js):
 *   - 401 wrong-aud → throws { code: 'GATEWAY_AUDIENCE_MISMATCH', httpStatus: 401, message }
 *   - scope denial (MCP server, HTTP 200 RPC error) → throws { code: 'mcp_tool_error', httpStatus: 200, rpcCode }
 *   - scope denial (gateway 403) → throws { code: 'gateway_policy_denied', httpStatus: 403 }
 *   - callToolViaGateway(null, ...) self-resolves the gateway URL via getMcpGatewayHttpUrl()
 */

const oauthService = require('./oauthService');
const { callToolViaGateway } = require('./mcpGatewayClient');
const { buildTokenEvent, decodeJwtClaims } = require('./agentMcpTokenService');
const configStore = require('./configStore');

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
 * Stamp every event in tokenChainEvents with the useCaseId so they are
 * filterable in the activity feed without a separate lookup.
 * Mutates in place; returns the same array.
 * @param {object[]} events
 * @param {string} useCaseId
 * @returns {object[]}
 */
function _stampUseCaseId(events, useCaseId) {
  if (!useCaseId) { return events; }
  events.forEach(function (ev) { ev.useCaseId = useCaseId; });
  return events;
}

/**
 * Run an attack simulation against the real gateway with a real-deficient token.
 *
 * @param {string} sim - The attack sim id ('insufficient-scope' or 'wrong-aud')
 * @param {object} req - Express request (for session + useCaseId)
 * @returns {Promise<{sim, status, errorCode, reason, tokenChainEvents, useCaseId}>}
 */
async function runAttackSim(sim, req) {
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

  // Catalog slugs (useCases.js UC5.useCaseId / UC11.useCaseId)
  const useCaseId = sim === 'insufficient-scope' ? 'insufficient-scope' : 'bad-client-gateway';
  const tokenChainEvents = [];

  if (sim === 'insufficient-scope') {
    return _runInsufficientScope(subjectToken, useCaseId, tokenChainEvents);
  }

  if (sim === 'wrong-aud') {
    return _runWrongAud(subjectToken, useCaseId, tokenChainEvents);
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
    exchangedToken = await oauthService.performTokenExchange(
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
    _stampUseCaseId(tokenChainEvents, useCaseId);
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
    _stampUseCaseId(tokenChainEvents, useCaseId);
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
    _stampUseCaseId(tokenChainEvents, useCaseId);
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
    _stampUseCaseId(tokenChainEvents, useCaseId);
    return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
  }
}

module.exports = { runAttackSim };
