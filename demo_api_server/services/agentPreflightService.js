'use strict';

/**
 * agentPreflightService.js
 *
 * Pre-flight authorization check: the agent asks P1AZ whether it is permitted
 * to call a tool BEFORE dispatching it, receiving complete directives (PERMIT /
 * DENY / HITL + challengeId) in one response.
 *
 * Replaces the simulated-only checkLocalAuthzGate (verticalMcpExecution.js:77)
 * which never called PingOne Authorize and only ran in dev (ff_authorize_simulated=true).
 *
 * Exported: evaluate({ req, tool, params, hitlChallengeId? })
 *   → { decision: 'PERMIT'|'DENY'|'HITL'|'STEP_UP', ... }
 */

const configStore = require('./configStore');
const { evaluateMcpFirstToolGate } = require('./mcpToolAuthorizationService');
const hitlServiceClient = require('./hitlServiceClient');
// agentMcpTokenService is required lazily inside evaluate() so that Jest's resetModules()
// in afterEach does not stale the mock reference when a test re-requires the module.

/**
 * Evaluate authorization for a tool call before execution.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req  - real Express request (has session)
 * @param {string} opts.tool                    - MCP tool / vertical action name
 * @param {object} [opts.params]                - tool parameters (used for amount etc.)
 * @param {string|null} [opts.hitlChallengeId]  - HITL challenge ID echoed by the agent on retry;
 *                                                must pass verifyHitlReceipt before PERMIT is issued.
 *                                                Never trust a raw boolean — a missing or invalid ID
 *                                                re-issues the HITL challenge (fail-closed).
 * @returns {Promise<{
 *   decision: 'PERMIT'|'DENY'|'HITL'|'STEP_UP',
 *   fallback?: boolean,
 *   reason?: string,
 *   engine?: string,
 *   evaluation?: object,
 *   type?: string,
 *   challengeId?: string,
 *   expiresAt?: string,
 *   instructions?: string,
 *   directives?: object,
 *   tokenEvents?: Array,
 * }>}
 */
async function evaluate({ req, tool, params = {}, hitlChallengeId = null }) {
  // Default fail-closed (matches transactions.js / authorize.js). Opt in with === 'true'.
  const FAIL_OPEN = configStore.get('ff_authorize_fail_open') === 'true';

  // Lazy-require so that Jest's resetModules() in afterEach does not stale
  // the mock reference when a test re-requires agentMcpTokenService inside a test body.
  const { resolveMcpAccessTokenWithEvents, decodeJwtClaims } = require('./agentMcpTokenService');

  // ── Token resolution ───────────────────────────────────────────────────────
  let agentToken = null;
  let userSub = null;
  let tokenEvents = [];

  try {
    const resolved = await resolveMcpAccessTokenWithEvents(req, tool);
    agentToken = resolved.token;
    userSub = resolved.userSub || null;
    tokenEvents = resolved.tokenEvents || [];
  } catch (err) {
    console.warn('[AgentPreflight] Token exchange failed for tool=%s: %s', tool, err.message);
    if (FAIL_OPEN) {
      return { decision: 'PERMIT', fallback: true, reason: 'token_exchange_failed', tokenEvents };
    }
    return { decision: 'DENY', reason: 'token_exchange_failed', message: err.message, tokenEvents };
  }

  const userAcr = req.session?.user?.acr;

  // ── HITL receipt verification (pre-flight path) ────────────────────────────
  // When the agent echoes back a challenge ID on retry, verify the receipt
  // against the canonical HITL service (3009) BEFORE calling the P1AZ gate.
  // Verified → skip the gate and PERMIT immediately.
  // Fail-closed: any error, mismatch, or non-approved status falls through to
  // the gate which will re-challenge.
  if (hitlChallengeId) {
    try {
      const { decodeJwtClaims: _decode } = require('./agentMcpTokenService');
      const agentId = agentToken ? (_decode(agentToken)?.claims?.sub || '') : '';
      const status = await hitlServiceClient.getChallengeStatus(hitlChallengeId);
      const verification = hitlServiceClient.verifyHitlReceipt(
        status,
        userSub || undefined,
        agentId || undefined,
        tool,
        Date.now(),
        params?.amount,
      );
      if (verification.ok) {
        return { decision: 'PERMIT', reason: 'hitl_receipt_verified', tokenEvents };
      }
      console.warn(
        '[AgentPreflight] HITL receipt invalid for tool=%s reason=%s — re-challenging',
        tool,
        verification.message,
      );
    } catch (err) {
      console.warn(
        '[AgentPreflight] HITL receipt verification error for tool=%s: %s — re-challenging',
        tool,
        err.message,
      );
    }
  }

  // ── Authorization gate ─────────────────────────────────────────────────────
  let gate;
  try {
    gate = await evaluateMcpFirstToolGate({
      req,
      tool,
      agentToken: agentToken || '',
      userSub,
      userAcr,
      toolParams: params,
      hitlChallengeId: null,
    });
  } catch (err) {
    console.error('[AgentPreflight] Gate threw unexpectedly for tool=%s: %s', tool, err.message);
    if (FAIL_OPEN) {
      return { decision: 'PERMIT', fallback: true, reason: 'gate_error', tokenEvents };
    }
    return { decision: 'DENY', reason: 'gate_error', message: err.message, tokenEvents };
  }

  // Gate did not run (admin exempt, not configured, etc.) or returned undefined → treat as PERMIT
  if (!gate || !gate.ran) {
    return { decision: 'PERMIT', fallback: true, reason: (gate && gate.reason) || 'gate_not_run', tokenEvents };
  }

  // Gate errors (PingOne unavailable, simulated error)
  if (gate.simulatedError || gate.pingoneError) {
    const err = gate.simulatedError || gate.pingoneError;
    console.error('[AgentPreflight] Gate error for tool=%s: %s', tool, err.message);
    if (FAIL_OPEN) {
      return { decision: 'PERMIT', fallback: true, reason: 'authorize_error', tokenEvents };
    }
    return { decision: 'DENY', reason: 'authorize_unavailable', tokenEvents };
  }

  // PERMIT
  if (gate.permit) {
    return {
      decision: 'PERMIT',
      engine: gate.evaluation?.engine,
      evaluation: gate.evaluation,
      tokenEvents,
    };
  }

  // Blocked — parse error code into structured decision
  if (gate.block) {
    const body = gate.block.body || {};
    const errCode = body.error || '';

    // ── HITL ──────────────────────────────────────────────────────────────────
    if (errCode === 'mcp_hitl_required') {
      let challenge = null;
      try {
        const agentId = agentToken ? (decodeJwtClaims(agentToken)?.claims?.sub || '') : '';
        challenge = await hitlServiceClient.createChallenge(
          {
            tool,
            userId: userSub,
            agentId,
            userEmail: req.session?.user?.email,
            context: {
              decisionId: body.decisionId,
              decisionContext: body.decisionContext || 'McpFirstTool',
              reason: body.error_description,
            },
          },
          req.correlationId,
        );
      } catch (hitlErr) {
        console.error('[AgentPreflight] Failed to create HITL challenge for tool=%s: %s', tool, hitlErr.message);
      }

      return {
        decision: 'HITL',
        type: 'consent',
        engine: body.authorize_engine,
        decisionId: body.decisionId,
        challengeId: challenge?.challengeId || null,
        expiresAt: challenge?.expiresAt || null,
        instructions: challenge
          ? `Human approval required. Approve at the dashboard, then retry the tool with _hitl_challenge_id=${challenge.challengeId} in the arguments.`
          : 'Human approval required. Approve at the dashboard, then retry.',
        directives: {
          type: 'consent',
          challengeId: challenge?.challengeId || null,
          expiresAt: challenge?.expiresAt || null,
        },
        tokenEvents,
      };
    }

    // ── STEP_UP ────────────────────────────────────────────────────────────────
    if (errCode === 'mcp_step_up_required') {
      return {
        decision: 'STEP_UP',
        type: 'step_up',
        engine: body.authorize_engine,
        decisionId: body.decisionId,
        instructions: 'Step-up authentication (MFA) required. Complete MFA at the dashboard, then retry.',
        directives: { type: 'step_up' },
        tokenEvents,
      };
    }

    // ── DENY ───────────────────────────────────────────────────────────────────
    return {
      decision: 'DENY',
      engine: body.authorize_engine,
      decisionId: body.decisionId,
      reason: body.deny_reason || body.error_description || errCode,
      tokenEvents,
    };
  }

  // Unexpected gate shape — PERMIT with fallback flag
  console.warn('[AgentPreflight] Unexpected gate result shape for tool=%s', tool);
  return { decision: 'PERMIT', fallback: true, reason: 'unexpected_gate_result', tokenEvents };
}

module.exports = { evaluate };
