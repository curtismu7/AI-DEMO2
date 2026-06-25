'use strict';

/**
 * activityStepsBuilder.js — derive server-authoritative "What's happening"
 * narration steps from an agent-execution response envelope.
 *
 * Pure function, no side effects. Returns { steps, finalStatus }:
 *   steps — SEMANTIC step records (no human copy); the frontend
 *     (activityNarration.js / activityVocab.js) owns the vertical-aware wording:
 *       { key, kind: 'identity'|'delegation'|'authorize'|'tool'|'error'|'answer',
 *         status: 'running'|'done'|'failed', data?: object }
 *   finalStatus — the request's terminal state, the SINGLE source of truth the
 *     frontend uses to close the story: 'done' | 'failed' | null. null means the
 *     request is suspended awaiting user approval (step-up / HITL) — leave it open.
 *
 * The shapes of `data` match what the existing frontend mappers consume:
 *   authorize.data → authorizeDecisionToStep(data, institution)  ({ id, decision, obligations })
 *   tool.data      → reconcileToolSteps([data])[0]                ({ id, name, status })
 *
 * Ordering is authoritative (identity → delegation → authorize → tool(s) → outcome)
 * because only the BFF knows the true causal sequence of a request.
 */

// Error codes the BFF returns for authorization outcomes (see
// demoAgentLangGraphService.dispatchVerticalIntent return envelopes).
const DENY_ERRORS = new Set(['mcp_authorization_denied']);
const STEP_UP_ERRORS = new Set(['step_up_required']);
const HITL_ERRORS = new Set(['hitl_required']);

/**
 * @param {object} env agent-execution response envelope
 *   ({ success, error, toolsCalled, requiresConsent, requiresStepUp, decisionId })
 * @param {object} [opts]
 *   opts.clientAuthMethod — how the BFF authenticated to the PingOne token endpoint
 *   for the delegation exchange ('private_key_jwt' | 'basic' | 'post'); surfaced on
 *   the delegation step so the narration can name JWKS vs client_secret auth.
 * @returns {{ steps: Array<{key,kind,status,data?}>, finalStatus: 'done'|'failed'|null }}
 */
function buildActivitySteps(env = {}, opts = {}) {
  const steps = [];
  const err = env.error || null;
  const tools = Array.isArray(env.toolsCalled) ? env.toolsCalled.filter(Boolean) : [];
  const decisionId = env.decisionId || 'preflight';
  // Suspended = waiting on the user (step-up / HITL approval) — the request
  // stays open. Everything else is terminal.
  const suspended = STEP_UP_ERRORS.has(err) || HITL_ERRORS.has(err) || env.requiresStepUp || env.requiresConsent;

  // Always: the agent confirmed identity and is acting under delegation.
  steps.push({ key: 'identity', kind: 'identity', status: 'done' });
  const delegationStep = { key: 'delegation', kind: 'delegation', status: 'done' };
  if (opts && opts.clientAuthMethod) {
    delegationStep.data = { clientAuthMethod: opts.clientAuthMethod };
  }
  steps.push(delegationStep);

  // Authorize decision — derived from the envelope's outcome semantics.
  let authzData = null;
  if (DENY_ERRORS.has(err)) {
    authzData = { id: decisionId, decision: 'DENY' };
  } else if (STEP_UP_ERRORS.has(err) || env.requiresStepUp) {
    authzData = { id: decisionId, decision: 'PERMIT', obligations: [{ type: 'step_up_required' }] };
  } else if (HITL_ERRORS.has(err) || env.requiresConsent) {
    authzData = { id: decisionId, decision: 'PERMIT', obligations: [{ type: 'hitl_consent_required' }] };
  } else if (tools.length > 0) {
    // A tool ran ⇒ Authorize permitted it.
    authzData = { id: decisionId, decision: 'PERMIT' };
  }
  if (authzData) {
    steps.push({
      key: `authz:${decisionId}`,
      kind: 'authorize',
      status: authzData.decision === 'DENY' ? 'failed' : 'done',
      data: authzData,
    });
  }

  // Tool step(s) — one per invoked tool. Presence in toolsCalled means it was
  // dispatched through the MCP pipeline, so render as completed ('done').
  for (const name of tools) {
    steps.push({
      key: `tool:${name}`,
      kind: 'tool',
      status: 'done',
      data: { id: name, name, status: 'done' },
    });
  }

  // Outcome.
  if (env.success) {
    steps.push({ key: 'answer', kind: 'answer', status: 'done' });
  } else if (err && !DENY_ERRORS.has(err) && !suspended) {
    // A genuine failure (tool error, outage) — not an authorization stop, which
    // the authorize step already narrates.
    steps.push({ key: 'error', kind: 'error', status: 'failed' });
  }

  // Terminal state — the single source of truth the frontend uses to close the
  // story. null leaves it open while the user is asked to approve (step-up/HITL).
  const finalStatus = suspended ? null : (env.success ? 'done' : 'failed');
  return { steps, finalStatus };
}

module.exports = { buildActivitySteps };
