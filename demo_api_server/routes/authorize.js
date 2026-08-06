// banking_api_server/routes/authorize.js
// Admin-only PingOne Authorize management endpoints:
//   GET  /api/authorize/decision-endpoints        — list all endpoints in the environment
//   GET  /api/authorize/recent-decisions          — last N decisions for the configured endpoint
//   POST /api/authorize/bootstrap-demo-endpoints  — worker token → create/reuse demo decision endpoints + save config
//   POST /api/authorize/evaluate-endpoint-bulk    — up to 20 decision requests in one PingOne bulk call
//   POST /api/authorize/pre-flight-bulk           — advisory batch pre-flight (ff_authorize_bulk_preflight)

'use strict';

const express = require('express');
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const {
  getRecentDecisions,
  getDecisionEndpoints,
  getAuthorizationPolicies,
  getAuthorizationPoliciesFromSnapshot,
  isConfigured,
  isWorkerCredentialReady,
  provisionDemoDecisionEndpoints,
  evaluateTransaction: evaluatePingOneTransaction,
  evaluateDecisionEndpoint,
  evaluateDecisionEndpointBulk,
  setEndpointRecording,
  warmup,
  checkPolicyReadiness,
} = require('../services/pingOneAuthorizeService');
const {
  getSimulatedRecentDecisions,
  evaluateTransaction: evaluateSimulatedTransaction,
  getDenyAmountUsd,
  getStepUpAmountUsd,
  getConfirmAmountUsd,
  getConsentTypes,
  getStepUpTypes,
} = require('../services/simulatedAuthorizeService');
const { getAuthorizationStatusSummary } = require('../services/transactionAuthorizationService');
const { getMcpFirstToolGateStatus, resolveExpectedMcpResourceUri } = require('../services/mcpToolAuthorizationService');
const { buildActorBridgeHeaders } = require('../services/mcpActorBridge');
const { logEvent } = require('../services/appEventService');
const agentPreflightService = require('../services/agentPreflightService');
const { evaluateLearningDemo, LEARNING_DEMO_TYPES } = require('../services/authorizeLearningDemos');

const router = express.Router();

/**
 * POST /api/authorize/warmup
 * Pre-warm the PingOne Authorize worker token + connection so the first real
 * decision after a cold start (container restart / long idle) doesn't blip into
 * the "Demo Authorize" degraded fallback on the agent panel. Best-effort and
 * server-side throttled; the SPA fires this fire-and-forget on page load. Any
 * authenticated user (the warm uses server-side worker creds, no delegation).
 * No-op in simulated mode or when worker creds are absent.
 */
router.post('/warmup', authenticateToken, async (_req, res) => {
  const result = await warmup();
  return res.json(result);
});

/**
 * GET /api/authorize/policy-readiness
 * Demo preflight (P1AZ hardening amendment §E). Verifies each configured gate's
 * decision endpoint EXISTS in PingOne Authorize, classified as
 * ready / policy_not_found / not_configured / error. It does NOT fire synthetic
 * decisions — those would pollute the recent-decisions log and, given the demo
 * snapshot's always-applicable catch-all rules, could not reliably surface
 * NOT_APPLICABLE drift anyway (a synthetic request would just hit the catch-all).
 * policy_not_found here means a configured endpoint id is missing from P1AZ —
 * fix PingOne Authorize before the demo. Admin-only; never throws.
 */
router.get('/policy-readiness', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }
  const result = await checkPolicyReadiness();
  return res.json(result);
});

/**
 * GET /api/authorize/decision-endpoints
 * List all PingOne Authorize decision endpoints in the configured environment.
 * Admin-only; used by the Config UI and education panel.
 */
router.get('/decision-endpoints', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }

  if (!isConfigured()) {
    return res.status(422).json({
      error: 'authorize_not_configured',
      message: 'PingOne Authorize worker credentials are not configured.',
    });
  }

  try {
    const endpoints = await getDecisionEndpoints();
    return res.json({ endpoints });
  } catch (err) {
    console.error('[authorize/decision-endpoints] Error:', err.message);
    return res.status(502).json({ error: 'upstream_error', message: err.message });
  }
});

/**
 * GET /api/authorize/recent-decisions?endpointId=&limit=
 * Fetch recent decisions for a decision endpoint.
 * Requires recordRecentRequests: true on the endpoint in PingOne Authorize.
 * Any authenticated user; used by the Live Policy Console, education panel, and
 * debugging UI (read-only PingOne data).
 */
router.get('/recent-decisions', authenticateToken, async (req, res) => {
  if (!isConfigured()) {
    return res.status(422).json({
      error: 'authorize_not_configured',
      message: 'PingOne Authorize worker credentials are not configured.',
    });
  }

  const { endpointId, limit } = req.query;
  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 20);

  try {
    const result = await getRecentDecisions(endpointId || undefined, parsedLimit);
    return res.json(result);
  } catch (err) {
    console.error('[authorize/recent-decisions] Error:', err.message);
    return res.status(502).json({ error: 'upstream_error', message: err.message });
  }
});

/**
 * GET /api/authorize/simulated-recent-decisions?limit=
 * In-memory decisions from Simulated Authorize (education). Parity with PingOne recent decisions UI.
 */
router.get('/simulated-recent-decisions', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }

  const parsedLimit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  try {
    const decisions = getSimulatedRecentDecisions(parsedLimit);
    return res.json({ decisions, source: 'simulated', limit: parsedLimit });
  } catch (err) {
    console.error('[authorize/simulated-recent-decisions] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

/**
 * GET /api/authorize/rules
 * Public (no auth) — returns simulated rule thresholds, MCP tool lists, and engine status.
 * No secrets: no PingOne credentials, no env vars. Safe for any user including unauthenticated.
 */
router.get('/rules', async (_req, res) => {
  try {
    return res.json({
      simulated: {
        confirmAmount: getConfirmAmountUsd(),
        denyAmount: getDenyAmountUsd(),
        stepUpAmount: getStepUpAmountUsd(),
        consentTypes: Array.from(getConsentTypes()).join(','),
        stepUpTypes: Array.from(getStepUpTypes()).join(','),
        mcpDenyTools: (configStore.get('SIMULATED_MCP_DENY_TOOLS') || '').split(',').filter(Boolean),
        mcpHitlTools: (configStore.get('SIMULATED_MCP_HITL_TOOLS') || '').split(',').filter(Boolean),
      },
      flags: {
        ff_authorize_mcp_first_tool: configStore.get('ff_authorize_mcp_first_tool') === 'true',
      },
      ...getAuthorizationStatusSummary(),
      ...getMcpFirstToolGateStatus(),
    });
  } catch (err) {
    console.error('[authorize/rules] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

/**
 * GET /api/authorize/evaluation-status
 * Which engine would run for transaction auth (no secrets).
 */
router.get('/evaluation-status', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }
  try {
    return res.json({
      ...getAuthorizationStatusSummary(),
      ...getMcpFirstToolGateStatus(),
    });
  } catch (err) {
    console.error('[authorize/evaluation-status] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

/**
 * POST /api/authorize/bootstrap-demo-endpoints
 * Admin-only: uses worker token + PingOne Platform API to create (or reuse) two decision endpoints
 * named "AI Demo — Transactions" and "AI Demo — MCP first tool", then saves their IDs
 * into config when persistence is available (KV / local SQLite).
 *
 * Body (optional): { policyId?, authorizationVersionId?, enableLiveAuthorize?, enableMcpFirstTool? }
 */
router.post('/bootstrap-demo-endpoints', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }

  if (!isWorkerCredentialReady()) {
    return res.status(422).json({
      error: 'worker_not_configured',
      message:
        'PingOne Authorize worker app is not configured. Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET in .env, or enter authorize_worker_client_id / authorize_worker_client_secret in Application Configuration.',
    });
  }

  const policyId =
    req.body && typeof req.body.policyId === 'string' && req.body.policyId.trim()
      ? req.body.policyId.trim()
      : undefined;
  const authorizationVersionId =
    req.body && typeof req.body.authorizationVersionId === 'string' && req.body.authorizationVersionId.trim()
      ? req.body.authorizationVersionId.trim()
      : undefined;
  const enableLiveAuthorize = req.body && req.body.enableLiveAuthorize === true;
  const enableMcpFirstTool = req.body && req.body.enableMcpFirstTool === true;

  try {
    const result = await provisionDemoDecisionEndpoints({ policyId, authorizationVersionId });

    let configSaved = false;
    if (!configStore.isReadOnly()) {
      const patch = {
        authorize_decision_endpoint_id: result.transactionEndpointId,
        authorize_mcp_decision_endpoint_id: result.mcpEndpointId,
      };
      if (enableLiveAuthorize) {
        // Authorization is always enabled; switch from simulated to live PingOne.
        patch.ff_authorize_real = 'true';
      }
      if (enableMcpFirstTool) {
        patch.ff_authorize_mcp_first_tool = 'true';
      }
      await configStore.setConfig(patch);
      configSaved = true;
    }

    const copyEnvHint = !configSaved
      ? `Add to Vercel (or .env): PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID=${result.transactionEndpointId} and PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID=${result.mcpEndpointId}`
      : null;

    const createdParts = [];
    if (result.created.transaction) createdParts.push('transactions endpoint');
    if (result.created.mcp) createdParts.push('MCP endpoint');
    const verb = createdParts.length ? `Created ${createdParts.join(' and ')} in PingOne.` : 'Reused existing demo endpoints in PingOne.';

    return res.json({
      ok: true,
      transactionEndpointId: result.transactionEndpointId,
      mcpEndpointId: result.mcpEndpointId,
      created: result.created,
      configSaved,
      copyEnvHint,
      message: `${verb} ${configSaved ? 'Saved IDs to application configuration.' : 'Copy endpoint IDs into configuration or environment variables.'}`,
    });
  } catch (err) {
    console.error('[authorize/bootstrap-demo-endpoints] Error:', err.message);
    return res.status(502).json({ error: 'upstream_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Test routes — no authentication required (safe: read-only evaluation calls)
// ---------------------------------------------------------------------------

const TEST_FALLBACK_USER_ID = process.env.AUTHZ_TEST_USER_ID || 'test-user';

/**
 * GET /api/authorize/test-status
 * Returns current engine status and thresholds for the test page.
 * No authentication required.
 */
router.get('/test-status', async (_req, res) => {
  try {
    const summary = getAuthorizationStatusSummary();
    const simulatedStepUp = parseFloat(process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT || '15000');
    const simulatedDeny   = parseFloat(process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT         || '50000');
    const depositsIncluded = configStore.get('ff_authorize_deposits') === 'true';

    const storedEndpointId = configStore.getEffective('authorize_decision_endpoint_id') || '';
    const storedWorkerClientId = configStore.getEffective('authorize_worker_client_id') || '';

    return res.json({
      activeEngine: summary.activeEngine,
      authorizeEnabled: summary.authorizeEnabledConfig,
      simulatedMode: summary.simulatedMode,
      pingoneConfigured: summary.pingoneConfigured,
      hasDecisionEndpointId: summary.hasDecisionEndpointId,
      hasPolicyId: summary.hasPolicyId,
      decisionEndpointId: storedEndpointId,
      workerClientId: storedWorkerClientId,
      thresholds: {
        simulated: {
          stepUp: simulatedStepUp,
          deny: simulatedDeny,
          stepUpTypes: ['transfer', 'withdrawal'],
          depositsIncluded,
        },
        pingone: {
          stepUp: 10000,
          deny: 50000,
          note: 'As configured in the AI Demo Transaction Authorization policy in PingOne Authorize',
          stepUpTypes: ['transfer', 'withdrawal'],
          depositsIncluded,
        },
      },
    });
  } catch (err) {
    console.error('[authorize/test-status] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

/**
 * POST /api/authorize/test-evaluate
 * Evaluate a transaction against the active authorization engine (simulated or PingOne).
 * No authentication required — safe because this is a read-only policy decision call.
 *
 * Body: { amount: number, type: 'transfer'|'withdrawal'|'deposit', acr?: string, userId?: string }
 */
router.post('/test-evaluate', async (req, res) => {
  const { amount, type, acr, userId: bodyUserId, demoType } = req.body || {};

  // Learning-page demos (abac / indeterminate / payloadFilter / obligations).
  // Routed by an explicit demoType discriminator; the default transaction path
  // (no demoType, or demoType === 'transaction') is untouched below.
  if (demoType && demoType !== 'transaction') {
    if (!LEARNING_DEMO_TYPES.includes(demoType)) {
      return res.status(400).json({ ok: false, error: `unknown demoType: ${demoType}` });
    }
    try {
      const d = await evaluateLearningDemo({ demoType, input: req.body?.input || {} });
      return res.json({
        ok: true,
        engine: 'simulated-learning',
        demoType,
        decision: d.decision,
        effect: d.effect,
        obligations: d.obligations || [],
        statements: d.statements || [],
        trace: d.trace,
        ...(d.output !== undefined ? { output: d.output } : {}),
        raw: d.raw,
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  const useCaseId = req.body?.useCaseId || '';
  // Force-live: call the configured PingOne Authorize decision endpoint directly,
  // regardless of the global enable flag or simulated mode. Lets the test page get
  // a REAL policy decision without turning on enforcement for live transactions.
  const forceLive = req.body?.live === true || req.body?.forceLive === true;

  if (amount == null || !type) {
    return res.status(400).json({ error: 'amount and type are required' });
  }
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const userId = bodyUserId || req.session?.user?.id || TEST_FALLBACK_USER_ID;
  const summary = getAuthorizationStatusSummary();

  // Force-live test path — bypass the off/simulated branches and hit PingOne directly.
  // No failover fallback here: a test must surface the real PingOne result or error,
  // not a masked simulated decision.
  if (forceLive) {
    if (!isConfigured()) {
      return res.status(409).json({
        ok: false,
        error: 'pingone_not_configured',
        message: 'PingOne Authorize worker credentials and a decision endpoint must be configured to run a live test.',
      });
    }
    try {
      const result = await evaluatePingOneTransaction({ userId, amount: numAmount, type, acr: acr || undefined });
      logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
        `Authorize [pingone/force-live] ${result.decision} — ${type} $${numAmount}`,
        { tag: result.decision === 'PERMIT' ? 'authorize/permit' : 'authorize/deny',
          metadata: { engine: 'pingone', forced: true, decision: result.decision, type, amount: numAmount, userId, stepUpRequired: result.stepUpRequired, decisionId: result.decisionId, path: result.path, ...(useCaseId ? { useCaseId } : {}) } });
      const pingConsent = result.hitlRequired || result.consentRequired || false;
      return res.json({
        ok: true,
        decision: result.decision,
        stepUpRequired: result.stepUpRequired,
        consentRequired: pingConsent,
        hitlRequired: pingConsent,
        engine: 'pingone',
        forced: true,
        path: result.path,
        decisionId: result.decisionId,
        parameters: { Amount: numAmount, TransactionType: type, UserId: userId, ...(acr ? { Acr: acr } : {}) },
        raw: result.raw,
        pingoneRequest: result._debug?.request,
        pingoneResponse: result._debug?.response,
      });
    } catch (err) {
      console.error('[authorize/test-evaluate force-live] Error:', err.message);
      logEvent('authorize', 'error', `Authorize force-live evaluation error: ${err.message}`,
        { tag: 'authorize/error', metadata: { forced: true, type, amount: numAmount, userId, error: err.message, ...(useCaseId ? { useCaseId } : {}) } });
      return res.status(502).json({
        ok: false,
        error: 'pingone_evaluation_failed',
        message: err.message,
        engine: 'pingone',
        forced: true,
      });
    }
  }

  // If authorization is off entirely, return an informational permit
  if (!summary.authorizeEnabledConfig && !summary.simulatedMode) {
    logEvent('authorize', 'info', `Authorize bypassed — authorization is disabled`,
      { tag: 'authorize/bypass', metadata: { engine: 'off', type, amount: numAmount, userId, ...(useCaseId ? { useCaseId } : {}) } });
    return res.json({
      ok: true,
      decision: 'PERMIT',
      stepUpRequired: false,
      hitlRequired: false,
      engine: 'off',
      path: 'bypass',
      parameters: { Amount: numAmount, TransactionType: type, UserId: userId, ...(acr ? { Acr: acr } : {}) },
      note: 'Authorization is currently disabled. Enable it in Application Configuration to evaluate policies.',
    });
  }

  try {
    let result;

    if (summary.simulatedMode) {
      result = await evaluateSimulatedTransaction({ userId, amount: numAmount, type, acr: acr || undefined });
      logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
        `Authorize [simulated] ${result.decision} — ${type} $${numAmount}`,
        { tag: result.decision === 'PERMIT' ? 'authorize/permit' : 'authorize/deny',
          metadata: { engine: 'simulated', decision: result.decision, type, amount: numAmount, userId, stepUpRequired: result.stepUpRequired, path: result.path, ...(useCaseId ? { useCaseId } : {}) } });
      // F7: both fields always present so the response contract is identical
      // regardless of which engine is active. consentRequired is the canonical
      // name (HITL_CONSENT obligation); hitlRequired is kept as an alias for
      // legacy callers.
      const simConsent = result.consentRequired || false;
      return res.json({
        ok: true,
        decision: result.decision,
        stepUpRequired: result.stepUpRequired,
        consentRequired: simConsent,
        hitlRequired: simConsent,
        engine: 'simulated',
        path: result.path,
        decisionId: result.decisionId,
        parameters: result.raw?.parameters || { Amount: numAmount, TransactionType: type, UserId: userId },
        raw: result.raw,
      });
    }

    // PingOne Authorize (live)
    result = await evaluatePingOneTransaction({ userId, amount: numAmount, type, acr: acr || undefined });
    logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
      `Authorize [pingone] ${result.decision} — ${type} $${numAmount}`,
      { tag: result.decision === 'PERMIT' ? 'authorize/permit' : 'authorize/deny',
        metadata: { engine: 'pingone', decision: result.decision, type, amount: numAmount, userId, stepUpRequired: result.stepUpRequired, decisionId: result.decisionId, path: result.path } });
    // F7: normalize both field names — consentRequired (canonical) and
    // hitlRequired (alias) always present so callers don't need engine-specific
    // field name knowledge. Both are identical values.
    const pingConsent = result.hitlRequired || result.consentRequired || false;
    return res.json({
      ok: true,
      decision: result.decision,
      stepUpRequired: result.stepUpRequired,
      consentRequired: pingConsent,
      hitlRequired: pingConsent,
      engine: 'pingone',
      path: result.path,
      decisionId: result.decisionId,
      parameters: { Amount: numAmount, TransactionType: type, UserId: userId, ...(acr ? { Acr: acr } : {}) },
      raw: result.raw,
      pingoneRequest: result._debug?.request,
      pingoneResponse: result._debug?.response,
    });
  } catch (err) {
    console.error('[authorize/test-evaluate] Error:', err.message);
    logEvent('authorize', 'error', `Authorize evaluation error: ${err.message}`,
      { tag: 'authorize/error', metadata: { type, amount: numAmount, userId, error: err.message } });

    // F6: apply failover policy for test-evaluate when PingOne is unreachable.
    // Legacy ff_authorize_fail_open=true maps to failover_mode=permit.
    const legacyFailOpen = configStore.getEffective('ff_authorize_fail_open') === 'true';
    const failoverMode = legacyFailOpen
      ? 'permit'
      : (configStore.getEffective('authorize_failover_mode') || 'fallback_simulated');

    if (failoverMode === 'fallback_simulated') {
      try {
        const fallback = await evaluateSimulatedTransaction({ userId, amount: numAmount, type, acr: acr || undefined });
        const fallbackConsent = fallback.consentRequired || false;
        logEvent('authorize', 'warning',
          `[Authorize] test-evaluate fell back to simulated (pingone unreachable)`,
          { tag: 'authorize/fallback-simulated', metadata: { type, amount: numAmount, userId, decision: fallback.decision } });
        return res.json({
          ok: true,
          decision: fallback.decision,
          stepUpRequired: fallback.stepUpRequired,
          consentRequired: fallbackConsent,
          hitlRequired: fallbackConsent,
          engine: 'fallback_simulated',
          fallback: { reason: 'pingone_unavailable', originalError: err.message },
          path: fallback.path,
          decisionId: fallback.decisionId,
          parameters: fallback.raw?.parameters || { Amount: numAmount, TransactionType: type, UserId: userId },
          raw: fallback.raw,
        });
      } catch (_fallbackErr) {
        return res.status(503).json({ ok: false, error: 'Authorization evaluation failed.', failoverMode });
      }
    }

    if (failoverMode === 'deny') {
      return res.status(503).json({
        ok: false,
        error: 'authorization_service_unavailable',
        error_description: 'PingOne Authorize is temporarily unavailable. Transactions are blocked (failover_mode=deny).',
        failoverMode,
      });
    }

    // failoverMode === 'permit': return 502 with clear message for test UI
    return res.status(502).json({ ok: false, error: err.message, failoverMode });
  }
});

// ---------------------------------------------------------------------------
// Mock authz server proxy — no auth required (read-only evaluation calls)
// ---------------------------------------------------------------------------

function _authzEndpoint() {
  return process.env.PINGAUTHORIZE_ENDPOINT || 'http://localhost:9001';
}
function _authzWorkerId() {
  return process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';
}

/**
 * GET /api/authorize/mock-authz-rules
 * Fetches structured rule definitions from the mock authz server (/rules endpoint).
 * No auth required — rule definitions are not secrets.
 */
router.get('/mock-authz-rules', async (_req, res) => {
  const authzEndpoint = _authzEndpoint();
  try {
    const response = await axios.get(`${authzEndpoint}/rules`, { timeout: 4000 });
    return res.json({ ok: true, ...response.data });
  } catch (err) {
    return _relayAuthzError(res, err, authzEndpoint);
  }
});

// Shared error relay for the mock-authz write proxies: surface the authz server's
// own status/body, map a refused connection to 503, anything else to 502.
function _relayAuthzError(res, err, authzEndpoint) {
  if (err.response) return res.status(err.response.status).json(err.response.data);
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      ok: false,
      error: 'authz_server_unavailable',
      message: `Mock authorization server not running at ${authzEndpoint}. Start it with ./run.sh.`,
      endpoint: authzEndpoint,
    });
  }
  return res.status(502).json({ ok: false, error: err.message });
}

// Optional defense-in-depth header forwarded to the authz server's env-gated guard.
function _authzAdminHeaders() {
  const headers = {};
  if (process.env.AUTHZ_ADMIN_TOKEN) headers['X-Authz-Admin-Token'] = process.env.AUTHZ_ADMIN_TOKEN;
  return headers;
}

/**
 * PUT /api/authorize/mock-authz-rules
 * Any authenticated user. Proxies a sparse rule patch to the mock authz server's
 * PUT /rules. (Demo affordance — every signed-in user can tune the policy and see
 * it change live; writes still require a session, and the authz server's optional
 * X-Authz-Admin-Token guard still applies when AUTHZ_ADMIN_TOKEN is set.)
 */
router.put('/mock-authz-rules', authenticateToken, async (req, res) => {
  const authzEndpoint = _authzEndpoint();
  try {
    const response = await axios.put(`${authzEndpoint}/rules`, req.body || {}, { timeout: 4000, headers: _authzAdminHeaders() });
    return res.json(response.data);
  } catch (err) {
    return _relayAuthzError(res, err, authzEndpoint);
  }
});

/**
 * POST /api/authorize/mock-authz-rules/reset
 * Any authenticated user. Clears all rule overrides on the mock authz server.
 */
router.post('/mock-authz-rules/reset', authenticateToken, async (_req, res) => {
  const authzEndpoint = _authzEndpoint();
  try {
    const response = await axios.post(`${authzEndpoint}/rules/reset`, {}, { timeout: 4000, headers: _authzAdminHeaders() });
    return res.json(response.data);
  } catch (err) {
    return _relayAuthzError(res, err, authzEndpoint);
  }
});

/**
 * GET /api/authorize/pingone-live-policy
 * Returns configured PingOne Authorize endpoints + recent decisions.
 * Requires authentication.
 */
router.get('/pingone-live-policy', authenticateToken, async (_req, res) => {
  const summary = getAuthorizationStatusSummary();

  const endpointId =
    configStore.getEffective('authorize_decision_endpoint_id') || null;
  const mcpEndpointId =
    configStore.getEffective('authorize_mcp_decision_endpoint_id') || null;

  const base = {
    ok: true,
    activeEngine: summary.activeEngine,
    pingoneConfigured: summary.pingoneConfigured,
    workerConfigured: isWorkerCredentialReady(),
    hasDecisionEndpointId: summary.hasDecisionEndpointId,
    transactionEndpointId: endpointId,
    mcpEndpointId,
    simulatedMode: summary.simulatedMode,
    environmentId: configStore.getEffective('pingone_environment_id') || null,
    region: configStore.getEffective('pingone_region') || 'com',
  };

  // The console only needs worker credentials to list and evaluate against any
  // endpoint — a configured default decision endpoint is not required.
  if (!isWorkerCredentialReady()) {
    return res.json({
      ...base,
      endpoints: [],
      recentDecisions: [],
      note: 'PingOne Authorize worker credentials not configured. Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET in .env, or enter authorize_worker_client_id / authorize_worker_client_secret in App Configuration.',
    });
  }

  try {
    const [endpointsResult, recentResult] = await Promise.allSettled([
      getDecisionEndpoints(),
      endpointId ? getRecentDecisions(endpointId, 10) : Promise.resolve({ decisions: [] }),
    ]);

    return res.json({
      ...base,
      endpoints: endpointsResult.status === 'fulfilled' ? (endpointsResult.value || []) : [],
      recentDecisions: recentResult.status === 'fulfilled' ? (recentResult.value?.decisions || []) : [],
      endpointsError: endpointsResult.status === 'rejected' ? endpointsResult.reason?.message : null,
      recentDecisionsError: recentResult.status === 'rejected' ? recentResult.reason?.message : null,
    });
  } catch (err) {
    console.error('[authorize/pingone-live-policy] Error:', err.message);
    return res.status(502).json({ ...base, ok: false, error: err.message });
  }
});

/**
 * GET /api/authorize/pingone-policies
 * Returns the live PingOne Authorize policy tree (Policy Sets → Policies →
 * Rules) for the configured environment. This is the actual authorization
 * policy that decision endpoints enforce — distinct from the endpoints
 * themselves. Read-only; any authenticated user.
 */
router.get('/pingone-policies', authenticateToken, async (_req, res) => {
  const environmentId = configStore.getEffective('pingone_environment_id') || null;

  // Prefer the repo snapshot first. PingOne's policy-editor API rejects worker
  // (client_credentials) tokens with 403 INSUFFICIENT_PERMISSIONS even when the
  // worker holds admin roles — a live GET always fails for this app. Serving the
  // import snapshot avoids a useless 403 round-trip and keeps the Policies card
  // populated for demos.
  const snapshotPolicies = getAuthorizationPoliciesFromSnapshot();
  if (Array.isArray(snapshotPolicies) && snapshotPolicies.length > 0) {
    return res.json({
      ok: true,
      policies: snapshotPolicies,
      environmentId,
      source: 'snapshot',
      note: 'Rendered from the repo snapshot (snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json) — the file these policies are imported from. PingOne’s policy-editor API rejects worker tokens, so a live read is not possible; if the policies were edited in the console after import, this view may lag the live tree.',
    });
  }

  if (!isWorkerCredentialReady()) {
    return res.json({
      ok: true,
      policies: [],
      environmentId,
      note: 'PingOne Authorize worker credentials not configured. Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET in .env, or enter authorize_worker_client_id / authorize_worker_client_secret in App Configuration.',
    });
  }

  try {
    const policies = await getAuthorizationPolicies();
    return res.json({ ok: true, policies, environmentId });
  } catch (err) {
    console.error('[authorize/pingone-policies] Error:', err.message);
    // PingOne rejects GET /authorizationPolicies for worker (client_credentials)
    // tokens with 403 INSUFFICIENT_PERMISSIONS even when the worker app holds
    // Environment Admin + Identity Data Admin (correctly env-scoped), the
    // Authorize Gateway Policy Evaluator role, and the license includes
    // Dynamic Authorization (verified live 2026-07-10: /decisionEndpoints and
    // /authorizationVersions return 200 with the same token; /authorizationPolicies,
    // /trustFramework/* and /deploymentPackages all 403). The policy-editor API
    // appears to accept only admin *user* (console) tokens. Surface that as
    // guidance (same note channel as the missing-credentials branch) instead of
    // a raw upstream error dump.
    if (err.status === 403) {
      return res.json({
        ok: true,
        policies: [],
        environmentId,
        note: 'PingOne returned 403 for the Authorize policy list. This endpoint currently rejects worker (client_credentials) tokens regardless of admin roles or license — policy evaluation and decision endpoints still work. View the policy tree in the PingOne console under Authorize → Policies.',
      });
    }
    return res.status(502).json({ ok: false, policies: [], environmentId, error: err.message });
  }
});

/**
 * Shared gate for the Live Policy Console routes: require configured worker
 * credentials. Any authenticated user may drive the console — it lives under the
 * non-admin Authorize nav, and the evaluation is a read-only PingOne decision
 * call (parity with the public /test-evaluate). Writes the error response and
 * returns false when the request should be rejected; returns true to proceed.
 */
function _requireWorker(res) {
  if (!isWorkerCredentialReady()) {
    res.status(409).json({
      ok: false,
      error: 'pingone_not_configured',
      message: 'PingOne Authorize worker credentials must be configured.',
    });
    return false;
  }
  return true;
}

/**
 * POST /api/authorize/evaluate-endpoint
 * Any authenticated user. Send an arbitrary Trust Framework parameters object
 * to ANY decision endpoint in the environment and return the live PingOne
 * verdict. Powers the Live Policy Console — always calls real PingOne (no
 * simulated fallback). Body: { endpointId: string, parameters: object }
 */
router.post('/evaluate-endpoint', authenticateToken, async (req, res) => {
  if (!_requireWorker(res)) return;

  const { endpointId, parameters } = req.body || {};
  const useCaseId = req.body?.useCaseId || '';
  if (!endpointId) {
    return res.status(400).json({ error: 'endpointId is required' });
  }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return res.status(400).json({ error: 'parameters must be an object' });
  }

  try {
    const result = await evaluateDecisionEndpoint(endpointId, parameters);
    const consent = result.consentRequired || result.hitlRequired || false;
    logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
      `Authorize [console] ${result.decision} — endpoint ${endpointId}`,
      { tag: result.decision === 'PERMIT' ? 'authorize/permit' : 'authorize/deny',
        metadata: { engine: 'pingone', console: true, endpointId, decision: result.decision, stepUpRequired: result.stepUpRequired, decisionId: result.decisionId, ...(useCaseId ? { useCaseId } : {}) } });
    return res.json({
      ok: true,
      decision: result.decision,
      stepUpRequired: result.stepUpRequired,
      consentRequired: consent,
      hitlRequired: consent,
      engine: 'pingone',
      path: result.path,
      decisionId: result.decisionId,
      endpointId,
      raw: result.raw,
      pingoneRequest: result._debug?.request,
      pingoneResponse: result._debug?.response,
    });
  } catch (err) {
    console.error('[authorize/evaluate-endpoint] Error:', err.message);
    logEvent('authorize', 'error', `Authorize console evaluation error: ${err.message}`,
      { tag: 'authorize/error', metadata: { console: true, endpointId, error: err.message, ...(useCaseId ? { useCaseId } : {}) } });
    return res.status(502).json({ ok: false, error: 'pingone_evaluation_failed', message: err.message });
  }
});

/**
 * POST /api/authorize/evaluate-endpoint-bulk
 * Any authenticated user. Send up to 20 Trust Framework parameter objects to
 * ONE decision endpoint in a single PingOne Authorize bulk decision request
 * and return the live per-item verdicts. Sibling of /evaluate-endpoint — same
 * worker gate, same live-only behaviour (no simulated fallback).
 * Body: { endpointId: string, sharedParameters?: object, decisionRequests: [{ label?: string, parameters: object }], chunk?: boolean, useCaseId?: string }
 */
router.post('/evaluate-endpoint-bulk', authenticateToken, async (req, res) => {
  if (!_requireWorker(res)) return;

  const { endpointId, sharedParameters, decisionRequests, chunk } = req.body || {};
  const useCaseId = req.body?.useCaseId || '';
  if (!endpointId) {
    return res.status(400).json({ error: 'endpointId is required' });
  }
  if (!Array.isArray(decisionRequests) || decisionRequests.length === 0) {
    return res.status(400).json({ error: 'decisionRequests must be a non-empty array' });
  }
  for (const item of decisionRequests) {
    if (!item || typeof item.parameters !== 'object' || Array.isArray(item.parameters)) {
      return res.status(400).json({ error: 'each decisionRequests[].parameters must be an object' });
    }
  }
  if (decisionRequests.length > 20 && chunk !== true) {
    return res.status(400).json({ error: 'decisionRequests exceeds the 20-item bulk limit; pass chunk:true to auto-chunk across multiple PingOne calls' });
  }
  if (sharedParameters !== undefined && (typeof sharedParameters !== 'object' || Array.isArray(sharedParameters))) {
    return res.status(400).json({ error: 'sharedParameters must be an object' });
  }

  // label is UI-only — stripped before the PingOne call, re-attached to results by index.
  const labels = decisionRequests.map((item) => item.label ?? null);
  const parametersList = decisionRequests.map((item) => item.parameters);

  try {
    const result = await evaluateDecisionEndpointBulk(endpointId, parametersList, sharedParameters);
    const results = result.results.map((r) => ({ ...r, label: labels[r.index] ?? null }));
    logEvent('authorize', result.summary.errors > 0 ? 'warning' : 'info',
      `Authorize [console] bulk decision — endpoint ${endpointId} (${result.summary.successful}/${result.summary.requested})`,
      { tag: 'authorize/bulk',
        metadata: { engine: 'pingone', console: true, bulk: true, endpointId, count: decisionRequests.length, correlationIds: result.correlationIds, summary: result.summary, ...(useCaseId ? { useCaseId } : {}) } });
    return res.json({
      ok: true,
      correlationId: result.correlationIds[0] || null,
      correlationIds: result.correlationIds,
      summary: result.summary,
      results,
      endpointId,
      pingoneRequest: result._debug?.request,
      pingoneResponse: result._debug?.response,
    });
  } catch (err) {
    console.error('[authorize/evaluate-endpoint-bulk] Error:', err.message);
    logEvent('authorize', 'error', `Authorize console bulk evaluation error: ${err.message}`,
      { tag: 'authorize/error', metadata: { console: true, bulk: true, endpointId, error: err.message, ...(useCaseId ? { useCaseId } : {}) } });
    if (err.code === 'bulk_limit_exceeded') {
      return res.status(400).json({ ok: false, error: 'bulk_limit_exceeded', message: err.message });
    }
    return res.status(502).json({ ok: false, error: 'pingone_evaluation_failed', message: err.message });
  }
});

/**
 * GET /api/authorize/mcp-console-defaults
 * Returns config-sourced defaults for the Live Policy Console's "MCP First Tool"
 * preset so a default Evaluate mirrors the real pipeline (a PERMIT) instead of
 * shipping a blank actor + mismatched audience (a guaranteed DENY). All fields
 * stay editable in the UI so an operator can still demonstrate a DENY.
 *
 *   actClientId    — the delegated actor (AI Agent client id = may_act.sub),
 *                    same value the gateway bridges as X-Act-Client-Id.
 *   tokenAudience  — equals mcpResourceUri so the policy's audience guard passes.
 *   mcpResourceUri — the expected resource URI for the active exchange mode.
 */
router.get('/mcp-console-defaults', authenticateToken, (_req, res) => {
  const actClientId = buildActorBridgeHeaders()['X-Act-Client-Id'] || '';
  const mcpResourceUri = resolveExpectedMcpResourceUri();
  return res.json({
    actClientId,
    tokenAudience: mcpResourceUri,
    mcpResourceUri,
  });
});

/**
 * POST /api/authorize/endpoints/:id/recording
 * Any authenticated user. Enable (default) or disable recent-decision
 * recording on a decision endpoint so the Recent Decisions list can populate.
 * Body: { enabled?: boolean }  (defaults to true)
 */
router.post('/endpoints/:id/recording', authenticateToken, async (req, res) => {
  if (!_requireWorker(res)) return;

  const enabled = req.body?.enabled !== false; // default true
  try {
    const result = await setEndpointRecording(req.params.id, enabled);
    logEvent('authorize', 'info',
      `Authorize recent-decision recording ${enabled ? 'enabled' : 'disabled'} — endpoint ${req.params.id}`,
      { tag: 'authorize/config', metadata: { endpointId: req.params.id, recordRecentRequests: enabled } });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[authorize/endpoints/recording] Error:', err.message);
    return res.status(502).json({ ok: false, error: 'upstream_error', message: err.message });
  }
});

/**
 * POST /api/authorize/test-evaluate-mcp
 * Proxy an MCP tool decision to the mock authz server.
 * Exercises all four mock authz rules: tools/list permit, act-claim check,
 * scope check, and HITL threshold for write tools.
 *
 * Body: { toolName, amount?, hitlApproved?, actClientId?, tokenScopes? }
 */
router.post('/test-evaluate-mcp', async (req, res) => {
  const { toolName, amount, hitlApproved, actClientId, tokenScopes: overrideScopes } = req.body || {};
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }

  const authzEndpoint = _authzEndpoint();
  const workerId = _authzWorkerId();

  let tokenScopes = overrideScopes || '';
  if (!tokenScopes && req.session?.oauthTokens?.accessToken) {
    try {
      const claims = JSON.parse(
        Buffer.from(req.session.oauthTokens.accessToken.split('.')[1], 'base64url').toString()
      );
      tokenScopes = claims.scope || '';
    } catch { /* ignore */ }
  }
  if (!tokenScopes) tokenScopes = 'read write';

  const parameters = {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    ToolName: toolName,
    ClientId: req.session?.user?.id || 'test-user',
    ActClientId: actClientId || '',
    TokenScopes: tokenScopes,
    TokenAudience: 'mcpgateway.ping.demo',
    TransactionAmount: amount != null ? String(amount) : '',
    TransactionType: toolName,
    ToAccountId: '',
    HitlApproved: hitlApproved ? 'true' : '',
  };

  const decisionUrl = `${authzEndpoint}/governance/pap/alpha/policy/${workerId}/decision`;

  try {
    const response = await axios.post(
      decisionUrl,
      { parameters },
      { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
    );
    return res.json({
      ok: true,
      engine: 'mock_authz_server',
      endpointUrl: decisionUrl,
      ...response.data,
      parametersUsed: parameters,
    });
  } catch (err) {
    console.error('[authorize/test-evaluate-mcp] Error:', err.message);
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        ok: false,
        error: 'authz_server_unavailable',
        message: `Mock authorization server not running at ${authzEndpoint}. Start it with ./run.sh.`,
      });
    }
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/authorize/test-mcp-live
 * Force-live evaluation of the MCP Delegation Authorization policy against the
 * configured PingOne Authorize decision endpoint. No auth — read-only decision call.
 * Body: { parameters: { DecisionContext, UserId, ToolName, TokenAudience, McpResourceUri,
 *   ActClientId, NestedActClientId, UserTier, RequiredGroup, InRequiredGroup, Acr, HitlApproved, Amount } }
 */
router.post('/test-mcp-live', async (req, res) => {
  const parameters = req.body?.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return res.status(400).json({ ok: false, error: 'parameters object is required' });
  }
  if (!isConfigured()) {
    return res.status(409).json({
      ok: false,
      error: 'pingone_not_configured',
      message: 'PingOne Authorize worker credentials and a decision endpoint must be configured to run a live MCP test.',
    });
  }
  const endpointId =
    configStore.getEffective('authorize_decision_endpoint_id') ||
    process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID;
  try {
    const result = await evaluateDecisionEndpoint(endpointId, parameters);
    const statements = (result.raw?.statements || []).map((s) => s.code || s.id).filter(Boolean);
    logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
      `Authorize [pingone/mcp-live] ${result.decision} — ${parameters.ToolName || ''}`,
      { tag: 'authorize/mcp-live', metadata: { decision: result.decision, toolName: parameters.ToolName, statements } });
    return res.json({
      ok: true,
      engine: 'pingone',
      decision: result.decision,
      stepUpRequired: result.stepUpRequired || false,
      consentRequired: result.consentRequired || result.hitlRequired || false,
      statements,
      decisionId: result.decisionId,
      raw: result.raw,
      pingoneRequest: result._debug?.request,
      pingoneResponse: result._debug?.response,
    });
  } catch (err) {
    console.error('[authorize/test-mcp-live] Error:', err.message);
    return res.status(502).json({ ok: false, error: 'pingone_evaluation_failed', message: err.message, engine: 'pingone' });
  }
});

/**
 * GET /api/authorize/test-introspect
 * Introspect the current session's access token via the mock authz server (RFC 7662).
 * Requires authentication — reads the session access token.
 */
router.get('/test-introspect', authenticateToken, async (req, res) => {
  const token = req.session?.oauthTokens?.accessToken;
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'no_token',
      message: 'No access token in session. Log in first.',
    });
  }

  const authzEndpoint = _authzEndpoint();
  const introspectUrl = `${authzEndpoint}/as/introspect`;

  try {
    // RFC 7662: introspect must be called by the token's issuing client.
    // For user tokens: authenticate as PINGONE_USER_CLIENT_ID (not the worker).
    const clientId = process.env.PINGONE_USER_CLIENT_ID || process.env.PINGONE_CLIENT_ID || '';
    const clientSecret = process.env.PINGONE_USER_CLIENT_SECRET || process.env.PINGONE_CLIENT_SECRET || '';
    const auth = clientId && clientSecret ? { username: clientId, password: clientSecret } : undefined;

    if (!auth) {
      console.warn('[authorize/test-introspect] WARNING: Introspection credentials not configured. Missing PINGONE_USER_CLIENT_ID/PINGONE_USER_CLIENT_SECRET (or fallback PINGONE_CLIENT_ID/PINGONE_CLIENT_SECRET). Introspection will likely fail with 401.');
    }

    const response = await axios.post(
      introspectUrl,
      new URLSearchParams({ token }).toString(),
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth,
      },
    );
    return res.json({
      ok: true,
      engine: 'mock_authz_server',
      endpointUrl: introspectUrl,
      ...response.data,
    });
  } catch (err) {
    console.error('[authorize/test-introspect] Error:', err.message);
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        ok: false,
        error: 'authz_server_unavailable',
        message: `Mock authorization server not running at ${authzEndpoint}. Start it with ./run.sh.`,
      });
    }
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/authorize/pre-flight
 * Agent pre-flight authorization check: evaluates whether a tool call is permitted
 * before the agent dispatches it. Returns PERMIT / DENY / HITL / STEP_UP with full
 * directives so the agent can act immediately without a 428 mid-execution surprise.
 *
 * Body: { tool: string, params?: object, consentGiven?: boolean }
 * Response: { decision, directives?, challengeId?, expiresAt?, instructions?, engine?, decisionId? }
 */
router.post('/pre-flight', authenticateToken, express.json(), async (req, res) => {
  const { tool, params, consentGiven } = req.body || {};

  if (!tool || typeof tool !== 'string' || !tool.trim()) {
    return res.status(400).json({ error: 'tool_required', message: 'tool must be a non-empty string' });
  }
  if (tool.length > 128) {
    return res.status(400).json({ error: 'tool_too_long', message: 'tool name exceeds 128 characters' });
  }
  if (params !== undefined && (typeof params !== 'object' || Array.isArray(params))) {
    return res.status(400).json({ error: 'params_invalid', message: 'params must be an object when provided' });
  }

  try {
    const result = await agentPreflightService.evaluate({
      req,
      tool: tool.trim(),
      params: params || {},
      consentGiven: consentGiven === true,
    });
    return res.json(result);
  } catch (err) {
    console.error('[authorize/pre-flight] Unexpected error for tool=%s: %s', tool, err.message);
    return res.status(500).json({ error: 'preflight_error' });
  }
});

/**
 * POST /api/authorize/pre-flight-bulk
 * Batch, ADVISORY sibling of /pre-flight — narrows which of several tools to
 * offer/grey out in one round trip. Never grants a call and mints no HITL
 * challenge (see agentPreflightService.evaluateBatch doc comment); the real
 * gate still runs unchanged when the agent actually invokes a tool. Gated by
 * ff_authorize_bulk_preflight (default off) — 404 when the flag is off, so
 * this ships inert until explicitly enabled.
 *
 * Body: { tools: [{ tool: string, params?: object }] }
 * Response: { ok, results?: [...], reason? } — see evaluateBatch's JSDoc.
 */
router.post('/pre-flight-bulk', authenticateToken, express.json(), async (req, res) => {
  if (configStore.getEffective('ff_authorize_bulk_preflight') !== 'true') {
    return res.status(404).json({ error: 'not_found' });
  }

  const { tools } = req.body || {};
  if (!Array.isArray(tools) || tools.length === 0) {
    return res.status(400).json({ error: 'tools_required', message: 'tools must be a non-empty array' });
  }
  for (const item of tools) {
    if (!item || typeof item.tool !== 'string' || !item.tool.trim()) {
      return res.status(400).json({ error: 'tool_required', message: 'each tools[].tool must be a non-empty string' });
    }
    if (item.tool.length > 128) {
      return res.status(400).json({ error: 'tool_too_long', message: 'tool name exceeds 128 characters' });
    }
    if (item.params !== undefined && (typeof item.params !== 'object' || Array.isArray(item.params))) {
      return res.status(400).json({ error: 'params_invalid', message: 'each tools[].params must be an object when provided' });
    }
  }

  try {
    const result = await agentPreflightService.evaluateBatch({
      req,
      tools: tools.map((t) => ({ tool: t.tool.trim(), params: t.params || {} })),
    });
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[authorize/pre-flight-bulk] Unexpected error: %s', err.message);
    return res.status(500).json({ error: 'preflight_bulk_error' });
  }
});

module.exports = router;
