'use strict';

/**
 * Use-Case Catalog API (read-only) — Plan A · Phase A1.
 *   GET /api/use-cases            → all 22 use cases, resolved for ?vertical (default banking)
 *   GET /api/use-cases/:id        → one resolved use case
 * The catalog is the SoT in config/useCases.js; this is a thin read surface.
 */

const express = require('express');
const router = express.Router();
const { listUseCases, resolveUseCase, VERTICALS } = require('../config/useCases');
const { authLevelFor } = require('../config/useCaseAuth');
const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { requiredFlagsForUseCase, isFlagOn } = require('../services/demoStepPrerequisites');
const {
  conformanceSubjects, outcomeFromAgentResponse, outcomeConforms, summarize,
} = require('../services/useCaseConformance');

function pickVertical(req, res) {
  const vertical = req.query.vertical || 'banking';
  if (!VERTICALS.includes(vertical)) {
    res.status(400).json({ error: 'unknown_vertical', vertical });
    return null;
  }
  return vertical;
}

// GET /api/use-cases  → list
router.get('/', (req, res) => {
  if (req.query.vertical === 'pingone-admin') {
    res.set({ 'Cache-Control': 'private, max-age=60' });
    // Admin steps bypass resolveUseCase, so stamp `auth` here or the UI would
    // fall back to its default and treat them like ordinary signed-in steps.
    return res.json({
      vertical: 'pingone-admin',
      useCases: ADMIN_DEMO_STEPS.map((u) => ({ ...u, auth: authLevelFor(u.id) })),
    });
  }
  const vertical = pickVertical(req, res);
  if (!vertical) return;
  res.set({ 'Cache-Control': 'private, max-age=60' });
  res.json({ vertical, useCases: listUseCases(vertical) });
});

// GET /api/use-cases/:id  → one
router.get('/:id', (req, res) => {
  const vertical = pickVertical(req, res);
  if (!vertical) return;
  const useCase = resolveUseCase(req.params.id, vertical);
  if (!useCase) return res.status(404).json({ error: 'unknown_use_case', id: req.params.id });
  res.json({ useCase });
});

// POST /api/demo/use-cases/run  → execute use case, return trigger text for agent
router.post('/demo/run', authenticateToken, async (req, res) => {
  const { useCaseId, triggerId } = req.body;
  const vertical = req.body?.vertical || req.query.vertical || 'banking';

  if (!VERTICALS.includes(vertical)) {
    return res.status(400).json({ success: false, error: 'unknown_vertical', vertical });
  }

  if (!useCaseId) {
    return res.status(400).json({ success: false, error: 'useCaseId is required' });
  }

  // useCaseId is the slug (e.g. 'delegated-access-with-proof'), not the UC# id (UC1)
  // Find the use case by slug, then resolve it for the vertical
  const rawUseCase = require('../config/useCases').USE_CASES?.find(u => u.useCaseId === useCaseId);
  if (!rawUseCase) {
    return res.status(400).json({ success: false, error: 'Invalid useCaseId' });
  }

  const useCase = resolveUseCase(rawUseCase.id, vertical);
  if (!useCase) {
    return res.status(400).json({ success: false, error: 'Use case not found for vertical' });
  }

  // Auto-arm every feature flag this use case declares it needs, so running any
  // step "just works" without manual preflight toggling. That is the maturity
  // 'flag:<name>' gate (UC2 → ff_a2a_delegation, UC14b → ff_rar) AND the two
  // MCP_GATEWAY_RUNTIME_FLAGS any tool-dispatching chip needs — without those,
  // Exchange #2 fails invalid_scope and the agent shows the opaque
  // "That step couldn't be completed". Do not narrow this back to maturity only:
  // the client mirror is the only other arming path and it has drifted before.
  // Non-fatal: a store failure shouldn't block dispatch.
  for (const flag of requiredFlagsForUseCase(useCase)) {
    try {
      if (!isFlagOn(configStore.getEffective(flag))) {
        await configStore.setRaw({ [flag]: 'true' });
      }
    } catch (err) {
      console.error(`[useCases] failed to arm ${flag} for ${useCase.id} (non-fatal):`, err.message);
    }
  }

  if (triggerId) {
    // Use cases expose a single `trigger` (with an optional `id`), not a `triggers` array.
    if (useCase.trigger?.id !== triggerId) {
      return res.status(400).json({ success: false, error: 'Invalid triggerId' });
    }
  }

  res.json({
    success: true,
    useCaseId: useCase.useCaseId,
    triggerText: useCase.trigger?.text || '',
    type: useCase.type || 'chip',
    vertical,
    message: 'Use case queued for execution',
  });
});

/**
 * POST /api/use-cases/conformance/run
 *
 * Run every chip use case whose `expectedOutcome` is comparable and report what
 * the policy ACTUALLY did. This is the check UC26's verdict cannot make: that
 * verdict compares the token-chain evidence, and DENY / STEP_UP / HITL all
 * produce the same chain shape, so four different controls can all render green
 * while three of them enforce the wrong one.
 *
 * Sequential on purpose — these run real agent turns against the live gateway,
 * and firing them concurrently would interleave HITL challenges between chips.
 *
 * Body: { vertical?: string, only?: string[] }  (only = UC ids, for a fast re-check)
 */
router.post('/conformance/run', authenticateToken, async (req, res) => {
  const vertical = req.body?.vertical || 'banking';
  if (!VERTICALS.includes(vertical)) {
    return res.status(400).json({ success: false, error: 'unknown_vertical', vertical });
  }
  const only = Array.isArray(req.body?.only) ? new Set(req.body.only) : null;
  const subjects = conformanceSubjects(vertical).filter((s) => !only || only.has(s.id));
  if (!subjects.length) {
    return res.status(400).json({ success: false, error: 'no_comparable_use_cases', vertical });
  }

  const { processAgentMessage } = require('../services/demoAgentLangGraphService');
  const userId = req.session?.user?.id;
  const rows = [];

  for (const s of subjects) {
    let actual = 'UNKNOWN';
    let reply = '';
    let error = null;
    try {
      // Arm what the use case declares it needs, same as /demo/run — otherwise a
      // flag-gated chip reports a false mismatch. Non-fatal.
      for (const flag of requiredFlagsForUseCase(resolveUseCase(s.id, vertical) || {})) {
        try {
          if (!isFlagOn(configStore.getEffective(flag))) await configStore.setRaw({ [flag]: 'true' });
        } catch (_e) { /* non-fatal */ }
      }
      const agentResponse = await processAgentMessage({
        message: s.trigger,
        userId,
        userToken: req.session?.oauthTokens?.accessToken,
        sessionId: req.session?.id,
        tokenEvents: [],
        langchainConfig: req.session?.langchain_config || {},
        vertical,
        req,
      });
      actual = outcomeFromAgentResponse(agentResponse);
      reply = String(agentResponse?.reply || '').slice(0, 200);
    } catch (e) {
      error = e.message || 'run failed';
    }
    rows.push({ ...s, actual, ok: !error && outcomeConforms(s.expected, actual), reply, error });
  }

  return res.json({ success: true, vertical, rows, summary: summarize(rows) });
});

// POST /api/use-cases/uc20/audit  → UC20 audit trail (full trace reconstruction)
router.post('/uc20/audit', authenticateToken, async (req, res) => {
  try {
    const appEventService = require('../services/appEventService');
    const { userId, sub } = req.user || { userId: 'unknown', sub: 'unknown' };

    // Query the audit trail for this user's recent events
    // This demonstrates a complete trace: token exchange → authorize → tool dispatch
    const events = await appEventService.getEvents({
      userId,
      useCaseId: 'UC20',
      limit: 100,
      orderBy: 'createdAt DESC',
    });

    // Filter for a complete chain: token + authorize + mcp events
    const tokenEvents = events.filter(e => e.type === 'token_exchange');
    const authzEvents = events.filter(e => e.type === 'authorize');
    const toolEvents = events.filter(e => e.type === 'tool_call');

    // Find the most recent complete trace
    const latestTokenEvent = tokenEvents[0];
    const traceId = latestTokenEvent?.traceId || `trace-${Date.now()}`;

    const traceEvents = events.filter(e => e.traceId === traceId || e.correlationId === traceId);

    res.json({
      success: true,
      traceId,
      summary: {
        userId,
        useCaseId: 'UC20',
        timestamp: new Date().toISOString(),
        eventCount: traceEvents.length,
      },
      events: traceEvents.map(e => ({
        type: e.type,
        timestamp: e.createdAt,
        details: {
          useCaseId: e.useCaseId,
          actChain: e.actChain,
          status: e.status,
          message: e.message,
        },
      })),
      evidence: {
        tokenChain: tokenEvents.slice(0, 5).map(e => ({
          type: e.type,
          actChain: e.actChain,
          timestamp: e.createdAt,
        })),
        authorizeDecisions: authzEvents.slice(0, 5).map(e => ({
          type: e.type,
          decision: e.status,
          timestamp: e.createdAt,
        })),
        toolDispatches: toolEvents.slice(0, 5).map(e => ({
          type: e.type,
          toolName: e.toolName,
          timestamp: e.createdAt,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'audit_trace_failed',
      message: err.message,
    });
  }
});

// UC15: CIBA out-of-band approval — In-memory store for demo CIBA requests
// NOTE: In production, persist to database with automatic cleanup of expired requests.
const cibaRequests = new Map(); // auth_req_id -> {userId, status, approvedAt, expiresAt}

// POST /api/use-cases/uc15/initiate  → UC15 CIBA initiate (start out-of-band flow)
router.post('/uc15/initiate', authenticateToken, (req, res) => {
  try {
    const { userId } = req.user || { userId: 'unknown' };
    const authReqId = `auth_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store CIBA request with 5-minute expiry
    const expiresAt = Date.now() + 5 * 60 * 1000;
    cibaRequests.set(authReqId, {
      userId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      expiresAt,
      approvedAt: null,
    });

    res.json({
      success: true,
      authReqId,
      message: 'CIBA flow initiated — push notification sent to user',
      details: {
        userId,
        status: 'PENDING',
        expirySeconds: 300,
        pollUrl: `/api/use-cases/uc15/poll?authReqId=${authReqId}`,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'ciba_initiate_failed',
      message: err.message,
    });
  }
});

// POST /api/use-cases/uc15/poll  → UC15 CIBA poll (check approval status)
router.post('/uc15/poll', authenticateToken, (req, res) => {
  try {
    const { authReqId, approve } = req.body;

    if (!authReqId) {
      return res.status(400).json({
        success: false,
        error: 'missing_auth_req_id',
        message: 'authReqId is required in request body',
      });
    }

    const cibaReq = cibaRequests.get(authReqId);
    if (!cibaReq) {
      return res.status(404).json({
        success: false,
        error: 'auth_req_not_found',
        message: `CIBA request ${authReqId} not found or expired`,
      });
    }

    // Check if expired
    if (cibaReq.expiresAt < Date.now()) {
      cibaRequests.delete(authReqId);
      return res.status(401).json({
        success: false,
        error: 'auth_req_expired',
        message: 'CIBA request expired — please initiate a new one',
      });
    }

    // Demo-only: simulate user approval via query param. Production: receive callback from authenticator device.
    if (approve === true) {
      cibaReq.status = 'APPROVED';
      cibaReq.approvedAt = new Date().toISOString();

      return res.json({
        success: true,
        decision: 'APPROVED',
        message: 'User approved the out-of-band authentication request',
        details: {
          authReqId,
          userId: cibaReq.userId,
          status: 'APPROVED',
          approvedAt: cibaReq.approvedAt,
          tokenIssued: true,
        },
      });
    }

    if (approve === false) {
      cibaReq.status = 'DENIED';
      cibaRequests.delete(authReqId);

      return res.status(403).json({
        success: false,
        decision: 'DENIED',
        message: 'User denied the out-of-band authentication request',
        details: {
          authReqId,
          userId: cibaReq.userId,
          status: 'DENIED',
          deniedAt: new Date().toISOString(),
        },
      });
    }

    // No decision yet — still pending
    res.json({
      success: true,
      decision: 'PENDING',
      message: 'Awaiting user approval on their registered device',
      details: {
        authReqId,
        userId: cibaReq.userId,
        status: 'PENDING',
        createdAt: cibaReq.createdAt,
        secondsUntilExpiry: Math.ceil((cibaReq.expiresAt - Date.now()) / 1000),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'ciba_poll_failed',
      message: err.message,
    });
  }
});

// POST /api/use-cases/uc10/scope-check  → UC10 insufficient scope (scope mismatch)
router.post('/uc10/scope-check', authenticateToken, (req, res) => {
  try {
    const { requiredScopes } = req.body;
    const tokenScopes = req.user?.scope?.split(' ') || [];

    if (!Array.isArray(requiredScopes) || requiredScopes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'missing_required_scopes',
        message: 'requiredScopes array is required in request body',
      });
    }

    // Check if token has all required scopes
    const hasSufficientScope = requiredScopes.every(scope => tokenScopes.includes(scope));
    const missingScopes = requiredScopes.filter(scope => !tokenScopes.includes(scope));

    if (!hasSufficientScope) {
      return res.status(403).json({
        success: false,
        decision: 'DENY',
        reason: 'insufficient_scope',
        message: `Token lacks required scopes: ${missingScopes.join(', ')}`,
        details: {
          requiredScopes,
          tokenScopes,
          missingScopes,
          hasSufficientScope: false,
        },
      });
    }

    // Token has all required scopes — permit
    res.json({
      success: true,
      decision: 'PERMIT',
      reason: 'sufficient_scope',
      message: `Token has all required scopes: ${requiredScopes.join(', ')}`,
      details: {
        requiredScopes,
        tokenScopes,
        missingScopes: [],
        hasSufficientScope: true,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'scope_check_failed',
      message: err.message,
    });
  }
});

/**
 * GET /golden/:vertical/:useCaseId — the captured known-good run for a catalog
 * chip (Layer-3 demo fallback). Goldens are CAPTURED from real runs
 * (demo_api_ui/tests/e2e/capture-goldens.real.spec.js), never hand-written, and
 * the UI renders them with an explicit REPLAY label. Params are allowlisted to
 * slug characters — no path traversal.
 */
router.get('/golden/:vertical/:useCaseId', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const slug = /^[a-z0-9][a-z0-9-]*$/i;
  const { vertical, useCaseId } = req.params;
  if (!slug.test(vertical) || !slug.test(useCaseId)) {
    return res.status(400).json({ error: 'bad_golden_key' });
  }
  const file = path.join(__dirname, '..', 'data', 'goldens', vertical, `${useCaseId}.json`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'golden_not_found', vertical, useCaseId });
  }
  try {
    return res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return res.status(500).json({ error: 'golden_unreadable', message: e.message });
  }
});

module.exports = router;
