'use strict';
/**
 * Guided Demo Track — run ledger + observation matcher.
 * Observations arrive from three read-only hooks (mcpToolAuditStore,
 * mcpToolPipeline authorize-block, attack-sim route); all hooks are
 * best-effort and this service must never throw into a host code path.
 * Matching rules: docs/superpowers/plans/2026-08-03-guided-demo-track-plan-a.md Task 2.
 */
const { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition } = require('../config/demoTrack');

let lmdb = null;
try { lmdb = require('./lmdb/demoTrackStore.lmdb'); } catch { /* tests without LMDB env */ }

/**
 * Human-readable "why" per enforcement error code — the demo teaches nothing
 * from a bare BLOCKED. Keys are the error codes the sims/pipeline actually
 * emit (see tests/real/shared/attack-sims-live.test.js taxonomy).
 */
const REASONS = {
  invalid_aud: 'Audience check failed at gateway introspection — the token was minted for a different resource (aud mismatch), so a replayed/stolen token is useless here.',
  missing_act: 'PingOne Authorize denied: no act claim — the call carried no delegated-actor chain, so direct impersonation of the user was refused.',
  mcp_invalid_actor: 'PingOne Authorize denied: invalid actor chain — an injected (rogue) actor failed the delegation check.',
  insufficient_scope: 'Scope check failed — the token\'s scopes do not cover this tool (read token used for a write, or an ungranted tool).',
  resource_owner_mismatch: 'Resource-ownership check — the target account belongs to a different user; cross-owner access is denied at the data plane.',
  invalid_signature: 'Intent-token signature check failed — the stated intent was tampered with after it was minted, so the gateway refused the call.',
  rar_amount_exceeded: 'RAR authorization_details — the amount exceeds the ceiling granted at authorization time.',
  gateway_policy_denied: 'PingGateway policy denied the request in the filter chain (rate limit, fail-closed introspection outage, or an explicit gateway rule).',
  mcp_authorize_denied: 'PingOne Authorize policy decision: DENY — the externalized policy refused this action; the tool was never invoked.',
  mcp_authorization_denied: 'PingOne Authorize policy decision: DENY — the externalized policy refused this action; the tool was never invoked.',
  mcp_step_up_required: 'Step-up required — PingOne Authorize demands fresh MFA before this action proceeds (HTTP 428 challenge).',
  mcp_hitl_required: 'Human-in-the-loop — a human must approve this action out-of-band; the agent cannot proceed on its own.',
  hitl_required: 'Human-in-the-loop — a human must approve this action out-of-band; the agent cannot proceed on its own.',
};
function _reasonFor(errorCode, fallback) {
  return (errorCode && REASONS[errorCode]) || fallback || (errorCode ? `denied with ${errorCode}` : null);
}

const ACTIVE_KEY_PREFIX = 'demo-track:active:';
const HISTORY_KEY_PREFIX = 'demo-track:history:';
const HISTORY_CAP = 20;
// How long a slot stays armed for the wildcard after the page asks to run it.
// Long enough for a chip round-trip (agent + gateway + P1AZ), short enough that
// a presenter who walks away does not leave the track open to passive traffic.
const ARM_TTL_MS = 120000;
const GAUNTLET_SET = new Set(GAUNTLET_SIMS.map(g => g.sim));

// Bucket used by any caller that doesn't (or can't) supply a sessionId — the
// dead-code observeToolCall path and any legacy test. Every live caller now
// passes req.sessionID, so two concurrent presenter sessions each get their
// own run instead of silently sharing (and clobbering) one process-global
// track — the bug that let one session's "Start New Run" wipe out another's
// in-progress walkthrough, and stamped it with unrelated traffic in between.
const DEFAULT_BUCKET = '_default';
function _bucketKey(sessionId) {
  return sessionId && typeof sessionId === 'string' ? sessionId : DEFAULT_BUCKET;
}

// In-memory: sessionId -> run / history array. LMDB persistence is per-bucket
// too, so a restart restores each session's own track instead of one shared one.
const _runs = new Map();
const _histories = new Map();

function _persist(bucket) {
  try {
    if (!lmdb) return;
    lmdb.put(ACTIVE_KEY_PREFIX + bucket, _runs.get(bucket) || null);
    lmdb.put(HISTORY_KEY_PREFIX + bucket, _histories.get(bucket) || []);
  } catch { /* persistence is best-effort */ }
}

function _hydrate(bucket) {
  if (!_histories.has(bucket)) {
    let history;
    try { history = (lmdb && lmdb.get(HISTORY_KEY_PREFIX + bucket)) || []; } catch { history = []; }
    _histories.set(bucket, history);
  }
  if (!_runs.has(bucket)) {
    let run;
    try { run = (lmdb && lmdb.get(ACTIVE_KEY_PREFIX + bucket)) || null; } catch { run = null; }
    _runs.set(bucket, run);
  }
}

function _newRun() {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt: new Date().toISOString(),
    activeStepId: TRACK_STEPS[0].stepId,
    slots: {},
    gauntlet: {},
  };
}

function _ensureRun(bucket) {
  _hydrate(bucket);
  if (!_runs.get(bucket)) { _runs.set(bucket, _newRun()); _persist(bucket); }
  return _runs.get(bucket);
}

function _stepById(stepId) { return TRACK_STEPS.find(s => s.stepId === stepId) || null; }

function _stepComplete(step, run) {
  if (step.stepId === 'attack-gauntlet') {
    return GAUNTLET_SIMS.every(g => run.gauntlet[g.sim] && run.gauntlet[g.sim].blocked);
  }
  const greenOk = !step.slots.green || run.slots[`${step.stepId}:green`];
  const redOk = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(greenOk && redOk);
}

function _maybeAdvance(run) {
  const idx = TRACK_STEPS.findIndex(s => s.stepId === run.activeStepId);
  if (idx === -1) return;
  if (!_stepComplete(TRACK_STEPS[idx], run)) return;
  const next = TRACK_STEPS[idx + 1];
  if (next) run.activeStepId = next.stepId;
}

/**
 * Candidate steps: active step first, then track order.
 */
function _candidates(run) {
  const active = _stepById(run.activeStepId);
  const rest = TRACK_STEPS.filter(s => s !== active);
  return [...(active ? [{ step: active }] : []), ...rest.map(step => ({ step }))];
}

/**
 * '*' fires only for the ONE slot the page armed, and only until it expires or
 * a fill consumes it. Keying the wildcard off the active step instead let any
 * passing tool call stamp the active step, advance the pointer, and walk the
 * whole track — filling every card with unrelated evidence.
 */
function _wildcardOk(run, stepId, color) {
  const arm = run.arm;
  if (!arm || arm.stepId !== stepId || arm.color !== color) return false;
  return Date.now() < arm.expiresAt;
}

function _toolMatches(slot, toolName, wildcardOk) {
  const tools = (slot.match && slot.match.tools) || [];
  if (tools.includes(toolName)) return true;
  return wildcardOk && tools.includes('*');
}

function _fill(bucket, run, stepId, color, stamp) {
  run.slots[`${stepId}:${color}`] = stamp;
  if (run.arm && run.arm.stepId === stepId && run.arm.color === color) run.arm = null;
  _maybeAdvance(run);
  _persist(bucket);
}

function observeToolCall({ toolName, success, timestamp, decisionId, errorCode }, sessionId) {
  try {
    const bucket = _bucketKey(sessionId);
    const run = _ensureRun(bucket);
    const at = timestamp || new Date().toISOString();
    for (const { step } of _candidates(run)) {
      if (success) {
        const g = step.slots.green;
        if (g && g.source === 'tool' && _toolMatches(g, toolName, _wildcardOk(run, step.stepId, 'green'))) {
          return _fill(bucket, run, step.stepId, 'green', {
            verdict: 'PERMIT', decisionId: decisionId || null, via: toolName, at,
            reason: `PingOne Authorize permitted ${toolName} — the delegated call satisfied policy and ran.`,
          });
        }
      } else {
        const r = step.slots.red;
        if (r && r.source === 'tool' && r.expected.includes('DENY') && _toolMatches(r, toolName, _wildcardOk(run, step.stepId, 'red'))) {
          return _fill(bucket, run, step.stepId, 'red', {
            verdict: 'DENY', decisionId: decisionId || null, via: toolName, at,
            errorCode: errorCode || null,
            reason: _reasonFor(errorCode, `${toolName} was denied — the tool was never invoked.`),
          });
        }
      }
    }
  } catch { /* never throw into the audit path */ }
}

function observeDecision({ tool, decision, decisionId, errorCode }, sessionId) {
  try {
    const bucket = _bucketKey(sessionId);
    const run = _ensureRun(bucket);
    const at = new Date().toISOString();
    for (const { step } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'tool' && r.expected.includes(decision) && _toolMatches(r, tool, _wildcardOk(run, step.stepId, 'red'))) {
        return _fill(bucket, run, step.stepId, 'red', {
          verdict: decision, decisionId: decisionId || null, via: tool, at,
          errorCode: errorCode || null,
          reason: _reasonFor(errorCode, `${tool} → ${decision}: the externalized policy stopped the call before the tool ran.`),
        });
      }
    }
  } catch { /* never throw into the pipeline */ }
}

function observeAttackSim({ sim, status, errorCode, decisionId }, sessionId) {
  try {
    const bucket = _bucketKey(sessionId);
    const run = _ensureRun(bucket);
    const at = new Date().toISOString();
    const blocked = Number(status) >= 400;
    const reason = _reasonFor(errorCode, blocked ? `attack blocked (HTTP ${status})` : null);
    if (GAUNTLET_SET.has(sim)) {
      run.gauntlet[sim] = { blocked, status, errorCode: errorCode || null, decisionId: decisionId || null, at, reason };
      _maybeAdvance(run);
      _persist(bucket);
    }
    if (!blocked) return;
    for (const { step } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'sim' && r.match.sims.includes(sim)) {
        return _fill(bucket, run, step.stepId, 'red', {
          verdict: 'BLOCKED', decisionId: decisionId || null, via: sim, at,
          errorCode: errorCode || null, reason,
        });
      }
    }
  } catch { /* never throw into the sim route */ }
}

function getState(sessionId) {
  return { track: getTrackDefinition(), run: _ensureRun(_bucketKey(sessionId)) };
}

function startRun(sessionId) {
  const bucket = _bucketKey(sessionId);
  _hydrate(bucket);
  const current = _runs.get(bucket);
  if (current) {
    const history = _histories.get(bucket) || [];
    _histories.set(bucket, [{ ...current, endedAt: new Date().toISOString() }, ...history].slice(0, HISTORY_CAP));
  }
  const next = _newRun();
  _runs.set(bucket, next);
  _persist(bucket);
  return next;
}

function setActiveStep(stepId, sessionId) {
  const bucket = _bucketKey(sessionId);
  const run = _ensureRun(bucket);
  if (_stepById(stepId)) { run.activeStepId = stepId; _persist(bucket); }
  return run;
}

/**
 * Arm one slot for the wildcard — the page calls this immediately before it
 * dispatches that slot's chip/sim, so the run about to happen is the only
 * traffic a '*' matcher can accept.
 */
function armSlot({ stepId, color, ttlMs } = {}, sessionId) {
  const bucket = _bucketKey(sessionId);
  const run = _ensureRun(bucket);
  if (!_stepById(stepId) || (color !== 'green' && color !== 'red')) return run;
  run.activeStepId = stepId;
  run.arm = { stepId, color, expiresAt: Date.now() + (Number.isFinite(ttlMs) ? ttlMs : ARM_TTL_MS) };
  _persist(bucket);
  return run;
}

function getHistory(sessionId) {
  const bucket = _bucketKey(sessionId);
  _hydrate(bucket);
  return _histories.get(bucket) || [];
}

function _resetForTests(sessionId) {
  if (sessionId) {
    const bucket = _bucketKey(sessionId);
    _runs.set(bucket, _newRun());
    _histories.set(bucket, []);
    return;
  }
  _runs.clear();
  _histories.clear();
  _runs.set(DEFAULT_BUCKET, _newRun());
  _histories.set(DEFAULT_BUCKET, []);
}

module.exports = {
  getState, startRun, setActiveStep, armSlot, getHistory,
  observeToolCall, observeDecision, observeAttackSim,
  _resetForTests,
};
