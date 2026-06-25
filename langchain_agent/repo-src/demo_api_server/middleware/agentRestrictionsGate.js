'use strict';

const configStore = require('../services/configStore');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');
const { cache: attrCache } = require('./agentRestrictionsCache');
const { createPendingDecision } = require('../routes/mcpDecisionPolling');
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
const { logger } = require('../utils/logger');

// Cache worker token for 50 minutes (PingOne CC tokens expire at 60m)
let _workerToken = null;
let _workerTokenExpiry = 0;

async function getWorkerToken() {
  if (_workerToken && Date.now() < _workerTokenExpiry) return _workerToken;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
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
      `https://auth.pingone.${region}/${envId}/as/token`,
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
    attrCache.set(userId, 'write');
    return 'write';
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
    const value = response.data?.agentRestrictions || 'write';
    attrCache.set(userId, value);
    return value;
  } catch (err) {
    logger.warn('[agentRestrictionsGate] PingOne fetch failed, defaulting to write', { userId, err: err.message });
    attrCache.set(userId, 'write');
    return 'write';
  }
}

async function agentRestrictionsGate(req, res, next) {
  if (configStore.get('ff_agent_restrictions') !== 'true') return next();

  const agentSub = req.headers['x-agent-sub'];
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
    logger.warn('[agentRestrictionsGate] No userId resolvable, skipping gate');
    return next();
  }

  try {
    const agentRestrictions = await fetchAgentRestrictions(userId);
    const requiredTier = getRequiredTier(toolName);

    if (!isAgentRestricted(agentRestrictions, requiredTier)) {
      return next();
    }

    const useSimulated = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);
    let authzResult;

    if (useSimulated) {
      authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
        agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
      });
    } else {
      const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
      if (typeof pingOneAuthorizeService.evaluateAgentRestrictions === 'function') {
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
      } else {
        authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
          agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
        });
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
    });
  } catch (err) {
    logger.error('[agentRestrictionsGate] Unexpected error, failing open', { err: err.message });
    return next();
  }
}

module.exports = { agentRestrictionsGate };
