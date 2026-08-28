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
// otherwise defeat the whole feature.
//
// The policy comes from resolveAuthorizeMode, the same source of truth the
// transaction and MCP-tool paths use, so one authorize_mode governs all three.
// This gate used to carry a private AGENT_RESTRICTIONS_FAILOVER dial with its own
// two-state vocabulary (restrict|permit), which meant an operator choosing
// authorize_mode='pingone_fallback_simulated' got the demo engine everywhere
// except here. Defaults are unchanged: authorize_mode='pingone' → 'deny'.
function failoverMode() {
  return simulatedAuthorizeService.resolveAuthorizeMode(configStore).failoverMode;
}

// The restriction value to apply when we cannot determine the real one.
// 'write' = unrestricted (fail open); 'none' = fully restricted (fail closed).
// Only an explicit failover_mode=permit opens this up — under
// 'fallback_simulated' the level is still unknown, so the gate stays closed and
// the simulated engine decides on a restricted user rather than an invented one.
function failoverRestrictionValue() {
  return failoverMode() === 'permit' ? 'write' : 'none';
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
    if (failoverMode() === 'permit') {
      logger.warn('[agentRestrictionsGate] No userId resolvable, failing open (failover_mode=permit)');
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

    // Engine selection comes from resolveAuthorizeMode, which reads
    // ff_authorize_real and authorize_mode the same way the transaction and MCP
    // paths do. The local derivation this replaces tested ff_authorize_real
    // `!== 'true'`, so a boolean true stored in LMDB (rather than the string)
    // sent this gate to the simulated engine while the rest of the system stayed
    // on P1AZ — resolveAuthorizeMode treats only an explicit false as the override.
    const { useSimulated } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
    let authzResult;
    let decidedEngine = useSimulated ? 'simulated' : 'pingone';

    if (useSimulated) {
      authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
        agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
      });
    } else {
      // P1AZ was selected, so P1AZ decides — there is no substitution branch here.
      // An unconfigured endpoint or an unreachable PingOne throws, and the catch
      // below applies the failover policy. This used to fall back to the
      // simulated engine whenever the real evaluator was missing, which it always
      // was; the response said authorize_engine:'simulated' but the gate was the
      // demo engine every time.
      const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
      try {
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
      } catch (p1azErr) {
        // Failover applies to a P1AZ evaluation failure specifically — scoped
        // here rather than to the whole block so an unrelated error later (a
        // failed createPendingDecision) can never be mistaken for an outage and
        // answered with a demo-engine decision.
        const mode = failoverMode();
        if (mode === 'permit') {
          logger.error('[agentRestrictionsGate] PingOne Authorize failed, failing open (failover_mode=permit) — this call is NOT authorized',
            { err: p1azErr.message, userId, toolName });
          return next();
        }
        if (mode === 'fallback_simulated') {
          logger.warn('[agentRestrictionsGate] PingOne Authorize failed, falling back to the simulated engine (failover_mode=fallback_simulated)',
            { err: p1azErr.message, userId, toolName });
          authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
            agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
          });
          decidedEngine = 'fallback_simulated';
        } else {
          throw p1azErr; // failover_mode=deny — the outer catch fails closed (503)
        }
      }
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
    if (failoverMode() === 'permit') {
      logger.error('[agentRestrictionsGate] Unexpected error, failing open (failover_mode=permit)', { err: err.message });
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
