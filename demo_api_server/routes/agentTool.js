'use strict';
/**
 * POST /internal/agent-tool
 *
 * Internal endpoint called by demo_agent_service when executing a tool
 * on behalf of the AG-UI agent run. Gated by BFF_INTERNAL_SECRET.
 *
 * Request body: { tool, args, sessionId }
 *   tool      — MCP tool name (e.g. 'get_my_accounts')
 *   args      — tool arguments object
 *   sessionId — the user's express-session ID (opaque, from agentRun.js)
 *
 * All tools (banking and vertical plugin) go through executeBffTool →
 * runMcpToolPipeline for full RFC 8693 token exchange, PingOne Authorize,
 * HITL gate, and SSE publishing. Token custody stays BFF-side.
 *
 * NOT mounted under /api/* — not browser-facing.
 * Bound to loopback (127.0.0.1) per REGRESSION_PLAN §3.
 */

const express = require('express');
// Resolved per call — routes are required long before the vault opens, so a
// module-scope snapshot could never see a vault-supplied BFF_INTERNAL_SECRET.
const {
  DEFAULT_INTERNAL_SECRET,
  internalSecret,
  isDefaultInternalSecret,
  internalSecretMatches,
} = require('../utils/internalSecret');
const router = express.Router();


// Keyed off VAULT_INTERNAL_STRICT, not NODE_ENV: k8s and docker-compose both pin
// the BFF to NODE_ENV=development deliberately, so this assertion was dead code
// in every real deployment.
if (process.env.VAULT_INTERNAL_STRICT === 'true' && isDefaultInternalSecret()) {
  console.error(
    `[BFF/agent-tool] FATAL: BFF_INTERNAL_SECRET is the dev default ('${DEFAULT_INTERNAL_SECRET}') ` +
    'under VAULT_INTERNAL_STRICT. Refusing to start.',
  );
  process.exit(1);
}

const { executeBffTool } = require('../services/bffMcpToolExecutor');
const { A2A_SPECIALISTS } = require('../config/a2aSpecialists');

/** The single vertical whose A2A specialist owns this tool (each sensitive_*
 * tool belongs to exactly one specialist), or null for ordinary tools. */
function verticalForA2aTool(toolName) {
  for (const [vertical, spec] of Object.entries(A2A_SPECIALISTS)) {
    if (Array.isArray(spec.tools) && spec.tools.includes(toolName)) return vertical;
  }
  return null;
}

function checkSecret(req, res) {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.post('/agent-tool', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { tool, args, sessionId } = req.body || {};

  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'tool_required' });
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId_required' });
  }

  if (!req.sessionStore) {
    return res.status(503).json({ error: 'session_store_unavailable' });
  }
  let session;
  try {
    session = await new Promise((resolve, reject) => {
      req.sessionStore.get(sessionId, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  } catch (err) {
    console.error('[agent-tool] session store error:', err.message);
    return res.status(503).json({ error: 'session_store_error', message: err.message });
  }

  if (!session || !session.oauthTokens) {
    return res.status(404).json({ error: 'session_not_found_or_no_tokens' });
  }

  const userId = session.user?.id;
  const userToken = session.oauthTokens?.accessToken;

  const fakeReq = {
    session: { ...session, id: sessionId },
    sessionID: sessionId,
    intentToken: session.intentToken || null,
    // flowTraceId was persisted on the session by agentRun.js for this run.
    // executeBffTool reads it from req.body to publish pipeline phase milestones
    // to the browser's live MCP flow SSE (the compliance checklist).
    // useCaseId was persisted on the session by agentRun.js to tag the flow for
    // cross-process observability; executeBffTool stamps token events with it.
    body: { flowTraceId: session.agentRunFlowTraceId || null, useCaseId: session.agentRunUseCaseId || null },
  };
  const tokenEvents = [];

  try {
    // A2A fast-path — parity with the heuristic dispatcher
    // (demoAgentLangGraphService.dispatchVerticalIntent): an a2aDelegated tool
    // is DENIED for the generalist alone by design (McpFirstTool:
    // a2a-delegation-required). External LLM agents calling back through this
    // endpoint used to run the direct call anyway and surface that DENY as the
    // final chat reply. Route it through the RFC 8693 nested-act delegation
    // service instead — the specialist chain is where authorization happens.
    // Lazy requires: keep route load free of the agent-service module graph.
    let raw;
    const a2aVertical = verticalForA2aTool(tool);
    if (a2aVertical) {
      const { executeA2aDelegation } = require('../services/demoAgentLangGraphService');
      raw = await executeA2aDelegation(
        a2aVertical,
        { tool, args: args || {} },
        { req: fakeReq, tokenEvents, sessionId },
      );
    } else {
      raw = await executeBffTool({
        name: tool,
        args: args || {},
        userId,
        userToken,
        req: fakeReq,
        tokenEvents,
        sessionId,
      });
    }

    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      parsed = { error: 'invalid_mcp_result' };
    }

    // Elicitation: same single hitlRequired envelope (extractHitlInterrupt in
    // demo_agent_service reads it generically — no agent-service change
    // needed), but reason:'elicitation_required' so the UI's retry sends
    // _elicitation_confirmed + _elicitation_id instead of _hitl_challenge_id.
    const isElicitation = parsed && parsed.error === 'elicitation_required';
    if (isElicitation) {
      return res.json({
        result: {
          hitlRequired: true,
          interruptId: parsed.elicitationId || `elicitation-${Date.now()}`,
          consentId: parsed.elicitationId || null,
          reason: 'elicitation_required',
          tool,
          message: parsed.prompt || parsed.message || 'This action requires your confirmation.',
          expiresAt: parsed.expiresAt || new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        },
        tokenEvents,
      });
    }

    // HITL / step-up: normalize to the SPA's single HITL contract
    // (result.hitlRequired + consentId + retry with _hitl_challenge_id).
    // Covers both pipeline codes (mcp_hitl_required, mcp_step_up_required)
    // and legacy registry codes (hitl_required, step_up_required).
    const isHitl = parsed && (
      parsed.error === 'mcp_hitl_required' ||
      parsed.error === 'hitl_required'
    );
    const isStepUp = parsed && (
      parsed.error === 'mcp_step_up_required' ||
      parsed.error === 'step_up_required'
    );
    if (isHitl || isStepUp) {
      return res.json({
        result: {
          hitlRequired: true,
          interruptId: parsed.challengeId || parsed.hitlChallengeId || `hitl-${Date.now()}`,
          consentId: parsed.challengeId || parsed.hitlChallengeId || null,
          reason: parsed.hitl?.type || parsed.challenge_type || (isStepUp ? 'step_up' : 'consent'),
          stepUp: isStepUp,
          tool,
          message: parsed.error_description || parsed.message || 'Human approval is required before this action can run.',
          expiresAt: parsed.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
        tokenEvents,
      });
    }

    return res.json({ result: parsed, tokenEvents });
  } catch (err) {
    console.error('[agent-tool] tool execution failed:', err.message);
    return res.status(502).json({
      error: 'tool_call_failed',
      message: err.message,
      tokenEvents,
    });
  }
});

module.exports = router;
