'use strict';

const configStore = require('../services/configStore');
const { getTokenEndpoint } = require('../services/oauthEndpointResolver');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');
const { cache: attrCache } = require('./agentRestrictionsCache');
const { createPendingDecision } = require('../routes/mcpDecisionPolling');
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
const { logger } = require('../utils/logger');

// Cache worker token for 50 minutes (PingOne CC tokens expire at 60m)
let _workerToken = null;
let _workerTokenExpiry = 0;

// Fail-closed by default. This middleware only runs when the operator has turned
// ff_agent_restrictions ON, so if the restriction level cannot be determined
// (worker creds missing, PingOne unreachable, API error, evaluation throws) the
// gate must NOT silently grant full 'write' access — a transient outage would
// otherwise defeat the whole feature. Set AGENT_RESTRICTIONS_FAILOVER=permit
// (or the agent_restrictions_failover config key) for the legacy fail-open.
function failoverPermits() {
  const mode = String(
    process.env.AGENT_RESTRICTIONS_FAILOVER ||
    configStore.get('agent_restrictions_failover') ||
    'restrict'
  ).toLowerCase();
  return mode === 'permit';
}

// The restriction value to apply when we cannot determine the real one.
// 'write' = unrestricted (fail open); 'none' = fully restricted (fail closed).
function failoverRestrictionValue() {
  return failoverPermits() ? 'write' : 'none';
}

async function getWorkerToken() {
  if (_workerToken && Date.now() < _workerTokenExpiry) return _workerToken;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = configStore.get('pingone_management_client_id') || process.env.PINGONE_MANAGEMENT_CLIENT_ID;
  const clientSecret = configStore.get('pingone_management_client_secret') || process.env.PINGONE_MANAGEMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret || !envId) return null;

  try {
    const axios = require('axios');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await axios.post(
      getTokenEndpoint(),
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000, validateStatus: () => true }
    );
    _workerToken = res.data.access_token;
    _workerTokenExpiry = Date.now() + 50 * 60 * 1000;
    return _workerToken;
  } catch (err) {
    logger.warn('[agentRestrictionsGate] Worker token fetch failed', { err: err.message });
    return null;
  }
}

async function fetchAgentRestrictions(userId) {
  const cached = attrCache.get(userId);
  if (cached !== null) return cached;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const workerToken = envId ? await getWorkerToken() : null;

  if (!workerToken || !envId) {
    // Can't look up restrictions — apply failover WITHOUT caching so a transient
    // config/outage does not poison the cache for the whole TTL.
    return failoverRestrictionValue();
  }

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}`,
      {
        headers: { Authorization: `Bearer ${workerToken}` },
        timeout: 3000,
        validateStatus: () => true
      }
    );
    // A non-2xx (404/5xx) is NOT an unrestricted user — treat it as
    // undeterminable and apply failover without caching. Only a successful
    // lookup is cached; a user object with no agentRestrictions attribute is a
    // genuinely unrestricted ('write') user.
    if (response.status < 200 || response.status >= 300) {
      logger.warn('[agentRestrictionsGate] PingOne lookup non-2xx, applying failover', { userId, status: response.status });
      return failoverRestrictionValue();
    }
    const value = response.data?.agentRestrictions || 'write';
    attrCache.set(userId, value);
    return value;
  } catch (err) {
    logger.warn('[agentRestrictionsGate] PingOne fetch failed, applying failover', { userId, err: err.message, failover: failoverRestrictionValue() });
    return failoverRestrictionValue();
  }
}

async function agentRestrictionsGate(req, res, next) {
  if (configStore.get('ff_agent_restrictions') !== 'true') return next();

  // Trust boundary: "is this an agent-originated request" must come from the
  // VERIFIED token's RFC 8693 `act` claim (req.user.actor, populated by
  // authenticateToken — which now runs before this gate, see server.js route
  // mounting), never from the raw, unauthenticated X-Agent-Sub client header.
  // A request that simply omits/forges that header must not be able to skip
  // the restriction-tier check. Same actor-identity idiom as requireDelegation
  // in middleware/auth.js.
  const actor = req.user?.actor;
  const agentSub = actor?.sub || actor?.client_id || null;
  if (!agentSub) return next();

  const toolName = req.headers['x-mcp-tool'] || '';

  // Prefer session user (browser flows); fall back to decoding Bearer JWT (MCP→BFF flows)
  let userId = req.session?.user?.oauthId || req.session?.user?.id;
  if (!userId) {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearerToken) {
      try {
        const [, payloadB64] = bearerToken.split('.');
        const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        userId = decoded.sub;
      } catch (_) {
        // malformed JWT — skip gate
      }
    }
  }

  if (!userId) {
    // Same "cannot determine the restriction level" contract as every other
    // branch in this file (worker token missing, PingOne non-2xx, PingOne
    // fetch error, unexpected exception) — this was previously the one
    // exception that unconditionally called next(), contradicting the
    // module's own documented fail-closed default.
    if (failoverPermits()) {
      logger.warn('[agentRestrictionsGate] No userId resolvable, failing open (AGENT_RESTRICTIONS_FAILOVER=permit)');
      return next();
    }
    logger.warn('[agentRestrictionsGate] No userId resolvable, failing closed');
    return res.status(503).json({
      code: 'agent_restrictions_unavailable',
      message: 'Agent restriction check is temporarily unavailable',
      tool: toolName,
    });
  }

  try {
    const agentRestrictions = await fetchAgentRestrictions(userId);
    const requiredTier = getRequiredTier(toolName);

    if (!isAgentRestricted(agentRestrictions, requiredTier)) {
      return next();
    }

    // Respect the configured authorize_mode, not just isSimulatedModeEnabled.
    // When ff_authorize_real=false, use simulated engine regardless of authorize_mode.
    // Otherwise, when authorize_mode is 'pingone', prefer P1AZ.
    const ffSimulated = configStore.getEffective('ff_authorize_real') !== 'true';
    const authorizeMode = configStore.getEffective('authorize_mode') || 'pingone';
    const useSimulated = ffSimulated || authorizeMode === 'simulated';
    let authzResult;
    const decidedEngine = useSimulated ? 'simulated' : 'pingone';

    if (useSimulated) {
      authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
        agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
      });
    } else {
      // P1AZ was selected, so P1AZ decides — there is no substitution branch. An
      // unconfigured endpoint or an unreachable PingOne throws, and the catch
      // below fails closed (503) under the default AGENT_RESTRICTIONS_FAILOVER.
      // This used to fall back to the simulated engine whenever the real
      // evaluator was missing, which it always was; the response said
      // authorize_engine:'simulated' but the gate was the demo engine every time.
      const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
      authzResult = await pingOneAuthorizeService.evaluateAgentRestrictions({
        subject: userId,
        environment: {
          agentRestrictions,
          requiredTier,
          agentSub,
          tool: toolName,
          ff_agent_restrictions: 'true',
        },
      });
    }

    if (authzResult.decision === 'PERMIT') return next();

    const { taskId } = await createPendingDecision(
      userId,
      {
        tool: toolName,
        decisionContext: 'AgentRestrictions',
        reason: authzResult.reason || 'Agent capability restricted by policy',
        decisionId: authzResult.decisionId,
      }
    );

    logger.info('[agentRestrictionsGate] DENY — HITL task created', { taskId, toolName, agentRestrictions, requiredTier, userId });

    return res.status(428).json({
      code: 'agent_restrictions_hitl',
      taskId,
      reason: authzResult.reason,
      tool: toolName,
      agentRestrictions,
      requiredTier,
      authorize_engine: decidedEngine,
    });
  } catch (err) {
    if (failoverPermits()) {
      logger.error('[agentRestrictionsGate] Unexpected error, failing open (AGENT_RESTRICTIONS_FAILOVER=permit)', { err: err.message });
      return next();
    }
    logger.error('[agentRestrictionsGate] Unexpected error, failing closed', { err: err.message });
    return res.status(503).json({
      code: 'agent_restrictions_unavailable',
      message: 'Agent restriction check is temporarily unavailable',
      tool: toolName,
    });
  }
}

module.exports = { agentRestrictionsGate };
