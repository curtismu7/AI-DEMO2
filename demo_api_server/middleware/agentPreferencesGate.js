'use strict';

const configStore = require('../services/configStore');
const agentPreferencesService = require('../services/agentPreferencesService');
const { getRequiredTier } = require('../services/agentRestrictionsService');
const { cache: prefsCache } = require('./agentPreferencesCache');
const { createPendingDecision } = require('../routes/mcpDecisionPolling');
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
const { logger } = require('../utils/logger');

// Worker token + PingOne user-attribute fetch, mirroring agentRestrictionsGate.
let _workerToken = null;
let _workerTokenExpiry = 0;

async function getWorkerToken() {
  if (_workerToken && Date.now() < _workerTokenExpiry) return _workerToken;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = configStore.get('pingone_worker_client_id') || process.env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = configStore.get('pingone_worker_client_secret') || process.env.PINGONE_WORKER_CLIENT_SECRET;

  if (!clientId || !clientSecret || !envId) return null;

  try {
    const axios = require('axios');
    // Machine-token endpoint + HTTP Basic client auth: the PingOne worker app
    // lives in PingOne even when browser login is PingFederate — getTokenEndpoint()
    // follows the interactive IdP and would send worker creds to PF (401); and
    // this worker app only accepts client_secret_basic (the same idiom
    // pingOneClientService.getManagementToken() uses).
    const { getPingOneTokenEndpoint } = require('../services/oauthEndpointResolver');
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    const res = await axios.post(
      getPingOneTokenEndpoint(),
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        timeout: 5000,
        validateStatus: () => true,
      }
    );
    _workerToken = res.data.access_token;
    _workerTokenExpiry = Date.now() + 50 * 60 * 1000;
    return _workerToken;
  } catch (err) {
    logger.warn('[agentPreferencesGate] Worker token fetch failed', { err: err.message });
    return null;
  }
}

async function fetchAgentPreferences(userId) {
  const cached = prefsCache.get(userId);
  if (cached !== null) return cached;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const workerToken = envId ? await getWorkerToken() : null;

  if (!workerToken || !envId) return agentPreferencesService.failoverPreferences(simulatedAuthorizeService, configStore);

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}`,
      { headers: { Authorization: `Bearer ${workerToken}` }, timeout: 3000, validateStatus: () => true }
    );
    if (response.status < 200 || response.status >= 300) {
      logger.warn('[agentPreferencesGate] PingOne lookup non-2xx, applying failover', { userId, status: response.status });
      return agentPreferencesService.failoverPreferences(simulatedAuthorizeService, configStore);
    }
    let raw = response.data?.agentPreferences;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { raw = null; }
    }
    // PingOne stores the attribute as a JSON STRING (schema type JSON holds a
    // string in the Management API), so a doubly-encoded value arrives as a
    // string containing a JSON string. Unwrap until we hit an object.
    for (let i = 0; i < 2 && typeof raw === 'string'; i++) {
      try { raw = JSON.parse(raw); } catch (_) { raw = null; break; }
    }
    const prefs = agentPreferencesService.normalizePreferences(raw);
    prefsCache.set(userId, prefs);
    return prefs;
  } catch (err) {
    logger.warn('[agentPreferencesGate] PingOne fetch failed, applying failover', { userId, err: err.message });
    return agentPreferencesService.failoverPreferences(simulatedAuthorizeService, configStore);
  }
}

// Session-start Protect agent-detection signal. The demo agent UI collects
// Signals once and posts them to /api/protect-auth/evaluations; when Protect's
// bot detection names an AI agent, this session flag records it so every agent
// tool call in that browser session is evaluated under the user's
// unknownAgentPolicy. Deliberately a signal, not per-call enforcement — revisit
// if the demo needs per-call Protect evaluations.
function markAgentDetected(req) {
  if (req.session) req.session.protectAgentDetected = true;
}

function isAgentDetected(req) {
  return req.session?.protectAgentDetected === true;
}

async function agentPreferencesGate(req, res, next) {
  if (configStore.get('ff_agent_preferences') !== 'true') return next();

  // Agent-originated requests only — verified RFC 8693 `act` claim, same trust
  // boundary as agentRestrictionsGate. Direct user calls are never gated.
  const actor = req.user?.actor;
  const agentSub = actor?.sub || actor?.client_id || null;
  if (!agentSub) return next();

  const toolName = req.headers['x-mcp-tool'] || (typeof req.body?.tool === 'string' ? req.body.tool : '');

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
    // Anonymous agent calls on sessionless routes (e.g. the MCP facade, which
    // has no browser session) cannot have user preferences — the preferences
    // are per-PingOne-user and there is no user here. Let the call through:
    // the agentRestrictionsGate and gateway policy still apply to it. The 503
    // branch below is for AGENT calls on session routes where the session
    // itself is broken (user missing from an otherwise-authenticated request).
    logger.warn('[agentPreferencesGate] No session user for agent call, skipping (sessionless route)', { toolName: toolName || null });
    return next();
  }

  try {
    const prefs = await fetchAgentPreferences(userId);
    const requiredTier = getRequiredTier(toolName);
    const amount = typeof req.body?.params?.amount === 'string' || typeof req.body?.params?.amount === 'number'
      ? parseFloat(req.body.params.amount)
      : undefined;
    const agentDetected = isAgentDetected(req) && prefs.detectAgent !== false;

    const result = agentPreferencesService.evaluatePreferences({ prefs, requiredTier, amount, agentDetected });
    if (result.decision === 'permit') return next();

    if (result.decision === 'deny') {
      logger.info('[agentPreferencesGate] DENY per user preference', { userId, toolName, requiredTier });
      return res.status(403).json({
        error: result.reason,
        code: 'agent_preferences_denied',
        message: result.reason,
        tool: toolName,
      });
    }

    // HITL: route the agent action to human approval via the same 428 contract
    // as agentRestrictionsGate, so the existing HITL modal + polling work as-is.
    const { taskId } = await createPendingDecision(userId, {
      tool: toolName,
      decisionContext: 'AgentPreferences',
      reason: result.reason,
    });

    logger.info('[agentPreferencesGate] HITL task created', { taskId, toolName, requiredTier, userId });

    return res.status(428).json({
      code: 'agent_preferences_hitl',
      taskId,
      reason: result.reason,
      tool: toolName,
      requiredTier,
    });
  } catch (err) {
    logger.error('[agentPreferencesGate] Unexpected error, failing closed', { err: err.message });
    return res.status(503).json({
      error: 'Agent preference check is temporarily unavailable',
      code: 'agent_preferences_unavailable',
      message: 'Agent preference check is temporarily unavailable',
      tool: toolName,
    });
  }
}

module.exports = { agentPreferencesGate, markAgentDetected, isAgentDetected };
