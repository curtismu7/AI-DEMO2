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
const {
  evaluateMcpFirstToolGate,
  decodeMcpTokenFacts,
  resolveAmountForPolicy,
  resolveResourceOwnerId,
  resolveExpectedMcpResourceUri,
  WRITE_TOOL_TYPE_MAP,
} = require('./mcpToolAuthorizationService');
const {
  buildMcpDelegationParameters,
  evaluateDecisionEndpointBulk,
  getMcpDecisionEndpointId,
  isMcpDelegationDecisionReady,
} = require('./pingOneAuthorizeService');
const simulatedAuthorizeService = require('./simulatedAuthorizeService');
const groupPolicy = require('./groupPolicy');
const { verticalManifest } = require('./verticalManifest');
const hitlServiceClient = require('./hitlServiceClient');
// agentMcpTokenService is required lazily inside evaluate()/evaluateBatch() so that
// Jest's resetModules() in afterEach does not stale the mock reference when a test
// re-requires the module.

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
        params || {},
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

/**
 * Batch, ADVISORY pre-flight for a list of tools — never grants a call, never
 * mints a HITL challenge, never consumes a step-up/HITL session credit.
 * Narrows which tools to offer/grey out in one round trip instead of one
 * evaluate() call per tool. The real gate (evaluateMcpFirstToolGate, run
 * again on the actual tool invocation) is the only call that can PERMIT —
 * see planning/PLAN-p1az-bulk-decision-requests.md "Hard constraint" for why.
 *
 * Resolves the MCP access token ONCE (the expensive RFC 8693 exchange), then
 * builds each tool's Trust Framework parameters via buildMcpDelegationParameters
 * — the SAME builder the real-time gate uses (Part 4a extraction) — before one
 * evaluateDecisionEndpointBulk call. RAR attributes (RarMaxAmount /
 * RarPermittedPayees / ToAccountId) are intentionally omitted from every item:
 * the one resolved token is not bound to any single tool's amount/payee, so
 * forwarding it for a different tool in the batch would be wrong in the
 * PERMISSIVE direction. Group policy is resolved once (user-specific) but
 * RequiredGroup / InRequiredGroup stay per-tool (tool-specific).
 *
 * No simulated-engine path — the bulk decision API has no mock/simulated
 * counterpart in this repo (see plan). When ff_authorize_simulated is on, or
 * the MCP decision endpoint isn't configured, this returns ok:false with a
 * reason instead of silently calling live PingOne or fabricating a verdict.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {Array<{ tool: string, params?: object }>} opts.tools
 * @returns {Promise<
 *   | { ok: true, results: Array<{ tool, decision: 'PERMIT'|'DENY'|'HITL'|'STEP_UP', advisory: true, decisionId?, reason?, nextStep? }>, tokenEvents: Array }
 *   | { ok: false, reason: string, results: [], tokenEvents: Array }
 * >}
 */
async function evaluateBatch({ req, tools }) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { ok: true, results: [], tokenEvents: [] };
  }

  if (simulatedAuthorizeService.isSimulatedModeEnabled(configStore)) {
    return { ok: false, reason: 'simulated_mode_not_supported', results: [], tokenEvents: [] };
  }

  const endpointId = getMcpDecisionEndpointId();
  if (!isMcpDelegationDecisionReady() || !endpointId) {
    return { ok: false, reason: 'authorize_not_configured', results: [], tokenEvents: [] };
  }

  // Lazy-require: see the file-top comment — Jest's resetModules() staled this
  // mock reference when captured at module-load time.
  const { resolveMcpAccessTokenWithEvents } = require('./agentMcpTokenService');

  let agentToken = null;
  let userSub = null;
  let tokenEvents = [];
  try {
    const resolved = await resolveMcpAccessTokenWithEvents(req, tools[0].tool);
    agentToken = resolved.token;
    userSub = resolved.userSub || null;
    tokenEvents = resolved.tokenEvents || [];
  } catch (err) {
    console.warn('[AgentPreflight] evaluateBatch token exchange failed: %s', err.message);
    return { ok: false, reason: 'token_exchange_failed', results: [], tokenEvents };
  }
  if (!agentToken) {
    return { ok: false, reason: 'no_agent_token', results: [], tokenEvents };
  }

  const userAcr = req.session?.user?.acr;
  const activeVerticalId = verticalManifest.resolver.activeIdFor(req) || 'banking';
  const facts = await decodeMcpTokenFacts({ req, agentToken, userSub });
  const mcpResourceUri = resolveExpectedMcpResourceUri();

  let userGroups = null;
  let userTier = null;
  const groupPolicyEnabled = groupPolicy.isEnabled(configStore);
  if (groupPolicyEnabled) {
    userGroups = await groupPolicy.groupsForUser(
      req.session?.user?.username,
      activeVerticalId,
      { pingOneUserId: facts.subjectId || req.session?.user?.oauthId || req.session?.user?.sub || null },
    );
    userTier = groupPolicy.resolveUserTier(userGroups, activeVerticalId);
  }

  const items = tools.map(({ tool, params }) => {
    const transactionType = WRITE_TOOL_TYPE_MAP[tool] || null;
    const recordAmount = resolveAmountForPolicy(tool, params, activeVerticalId, facts.subjectId);
    const amount = transactionType && params
      ? (recordAmount !== null ? recordAmount : parseFloat(params.amount || 0))
      : null;
    const resourceOwnerId = resolveResourceOwnerId(tool, params);
    const requiredGroup = groupPolicyEnabled ? groupPolicy.requiredGroupForTool(tool, activeVerticalId) : null;
    const inRequiredGroup = requiredGroup && userGroups ? userGroups.includes(requiredGroup) : null;

    return {
      tool,
      parameters: buildMcpDelegationParameters({
        userId: facts.subjectId,
        toolName: tool,
        tokenAudience: facts.tokenAudience,
        actClientId: facts.actClientId,
        nestedActClientId: facts.nestedActClientId,
        mcpResourceUri,
        acr: userAcr,
        transactionType,
        hitlApproved: false,
        hitlChallengeId: null,
        requiredGroup,
        userGroups,
        userTier,
        inRequiredGroup,
        amount,
        resourceOwnerId,
        rarMaxAmount: null,
        rarPermittedPayees: null,
        toAccountId: null,
        verticalId: activeVerticalId,
        clientId: facts.subjectId || null,
        mayActSub: facts.mayActSub,
        tokenScopes: facts.tokenScopes,
        tokenExp: facts.tokenExp,
        tokenIat: facts.tokenIat,
        tokenNbf: facts.tokenNbf,
        tokenIss: facts.tokenIss,
        tokenKid: facts.tokenKid,
        tokenKidKnown: facts.tokenKidKnown,
        userRole: facts.userRole,
      }),
    };
  });

  let bulk;
  try {
    bulk = await evaluateDecisionEndpointBulk(endpointId, items.map((i) => i.parameters));
  } catch (err) {
    console.error('[AgentPreflight] evaluateBatch bulk call failed: %s', err.message);
    return { ok: false, reason: 'authorize_unavailable', results: [], tokenEvents };
  }

  const results = bulk.results.map((r, i) => {
    const { tool } = items[i];
    if (r.decision === 'DENY') {
      return { tool, decision: 'DENY', advisory: true, decisionId: r.decisionId, reason: r.reason || null };
    }
    if (r.stepUpRequired) {
      return { tool, decision: 'STEP_UP', advisory: true, decisionId: r.decisionId, nextStep: 'preflight' };
    }
    if (r.hitlRequired) {
      return { tool, decision: 'HITL', advisory: true, decisionId: r.decisionId, nextStep: 'preflight' };
    }
    return { tool, decision: 'PERMIT', advisory: true, decisionId: r.decisionId };
  });

  return { ok: true, results, tokenEvents };
}

module.exports = { evaluate, evaluateBatch };
