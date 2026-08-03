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

const ACTIVE_KEY = 'demo-track:active';
const HISTORY_KEY = 'demo-track:history';
const HISTORY_CAP = 20;
const GAUNTLET_SET = new Set(GAUNTLET_SIMS.map(g => g.sim));

let _run = null;
let _history = null;

function _persist() {
  try {
    if (!lmdb) return;
    lmdb.put(ACTIVE_KEY, _run);
    lmdb.put(HISTORY_KEY, _history);
  } catch { /* persistence is best-effort */ }
}

function _hydrate() {
  if (_history === null) {
    try { _history = (lmdb && lmdb.get(HISTORY_KEY)) || []; } catch { _history = []; }
  }
  if (_run === null) {
    try { _run = lmdb && lmdb.get(ACTIVE_KEY); } catch { _run = null; }
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

function _ensureRun() {
  _hydrate();
  if (!_run) { _run = _newRun(); _persist(); }
  return _run;
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
 * Candidate steps: active step first, then track order. `wildcardOk` is true
 * only for the active step — '*' matches must not swallow observations from
 * the fallback scan.
 */
function _candidates(run) {
  const active = _stepById(run.activeStepId);
  const rest = TRACK_STEPS.filter(s => s !== active);
  return [...(active ? [{ step: active, wildcardOk: true }] : []), ...rest.map(step => ({ step, wildcardOk: false }))];
}

function _toolMatches(slot, toolName, wildcardOk) {
  const tools = (slot.match && slot.match.tools) || [];
  if (tools.includes(toolName)) return true;
  return wildcardOk && tools.includes('*');
}

function _fill(run, stepId, color, stamp) {
  run.slots[`${stepId}:${color}`] = stamp;
  _maybeAdvance(run);
  _persist();
}

function observeToolCall({ toolName, success, timestamp, decisionId }) {
  try {
    const run = _ensureRun();
    const at = timestamp || new Date().toISOString();
    for (const { step, wildcardOk } of _candidates(run)) {
      if (success) {
        const g = step.slots.green;
        if (g && g.source === 'tool' && _toolMatches(g, toolName, wildcardOk)) {
          return _fill(run, step.stepId, 'green', { verdict: 'PERMIT', decisionId: decisionId || null, via: toolName, at });
        }
      } else {
        const r = step.slots.red;
        if (r && r.source === 'tool' && r.expected.includes('DENY') && _toolMatches(r, toolName, wildcardOk)) {
          return _fill(run, step.stepId, 'red', { verdict: 'DENY', decisionId: decisionId || null, via: toolName, at });
        }
      }
    }
  } catch { /* never throw into the audit path */ }
}

function observeDecision({ tool, decision, decisionId }) {
  try {
    const run = _ensureRun();
    const at = new Date().toISOString();
    for (const { step, wildcardOk } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'tool' && r.expected.includes(decision) && _toolMatches(r, tool, wildcardOk)) {
        return _fill(run, step.stepId, 'red', { verdict: decision, decisionId: decisionId || null, via: tool, at });
      }
    }
  } catch { /* never throw into the pipeline */ }
}

function observeAttackSim({ sim, status, errorCode, decisionId }) {
  try {
    const run = _ensureRun();
    const at = new Date().toISOString();
    const blocked = Number(status) >= 400;
    if (GAUNTLET_SET.has(sim)) {
      run.gauntlet[sim] = { blocked, status, errorCode: errorCode || null, decisionId: decisionId || null, at };
      _maybeAdvance(run);
      _persist();
    }
    if (!blocked) return;
    for (const { step } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'sim' && r.match.sims.includes(sim)) {
        return _fill(run, step.stepId, 'red', { verdict: 'BLOCKED', decisionId: decisionId || null, via: sim, at });
      }
    }
  } catch { /* never throw into the sim route */ }
}

function getState() {
  return { track: getTrackDefinition(), run: _ensureRun() };
}

function startRun() {
  _hydrate();
  if (_run) {
    _history = [{ ..._run, endedAt: new Date().toISOString() }, ...(_history || [])].slice(0, HISTORY_CAP);
  }
  _run = _newRun();
  _persist();
  return _run;
}

function setActiveStep(stepId) {
  const run = _ensureRun();
  if (_stepById(stepId)) { run.activeStepId = stepId; _persist(); }
  return run;
}

function getHistory() {
  _hydrate();
  return _history || [];
}

function _resetForTests() { _run = _newRun(); _history = []; }

module.exports = {
  getState, startRun, setActiveStep, getHistory,
  observeToolCall, observeDecision, observeAttackSim,
  _resetForTests,
};
