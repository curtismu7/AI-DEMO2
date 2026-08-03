'use strict';

/**
 * Policy conformance — did the use case enforce the control it CLAIMS to enforce?
 *
 * WHY THIS IS NOT THE EXISTING VERDICT
 *
 * UC26's proof-of-enforcement compares a run against the use case's declared
 * `evidence` — which token-chain steps and activity kinds appeared. That catches
 * a broken chain, but it cannot tell two controls apart: UC6 (DENY), UC7
 * (STEP_UP), UC8 (HITL_REQUIRED) and UC22 (PERMIT) all declare the same evidence
 * shape (user-token -> token-exchange -> authorize-decision), so a run where all
 * four returned HITL renders four green verdicts while three demo the wrong
 * control. That is exactly what shipped, and what a golden capture surfaced on
 * 2026-08-03.
 *
 * `expectedOutcome` is the field that distinguishes them, and nothing compared it
 * to what actually happened. This module does only that comparison.
 *
 * @module services/useCaseConformance
 */

const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases.js');

/** A2A handoff chips need the specialist path, not a plain tool call. */
const A2A_UNROUTABLE = /specialist/i;

/**
 * Outcomes the catalog declares for chip-triggered use cases. Anything else is a
 * link/attack/edu entry with no runtime outcome to compare.
 */
const COMPARABLE_OUTCOMES = new Set([
  'PERMIT', 'DENY', 'DENY_401', 'STEP_UP', 'HITL_REQUIRED', 'DELEGATE_AND_EXECUTE',
]);

/**
 * Map what the agent actually returned onto the catalog's outcome vocabulary.
 *
 * The agent reports a gate as an `error` string on a 200 response (the request
 * succeeded; the POLICY blocked), so a missing error means the tool ran.
 *
 * @param {{ error?: string, success?: boolean, reply?: string }} agentResponse
 * @returns {string} one of COMPARABLE_OUTCOMES, or 'UNKNOWN'
 */
function outcomeFromAgentResponse(agentResponse) {
  const err = String((agentResponse && agentResponse.error) || '').toLowerCase();
  if (!err) return agentResponse && agentResponse.success === false ? 'UNKNOWN' : 'PERMIT';
  if (err.includes('step_up')) return 'STEP_UP';
  if (err.includes('hitl')) return 'HITL_REQUIRED';
  if (err.includes('401') || err.includes('token_inactive') || err.includes('unauthorized')) return 'DENY_401';
  if (err.includes('denied') || err.includes('deny') || err.includes('forbidden')) return 'DENY';
  return 'UNKNOWN';
}

/**
 * Is the observed outcome acceptable for the declared one?
 *
 * Exact match, with ONE deliberate allowance: DELEGATE_AND_EXECUTE (UC2/UC2.5)
 * completes as a PERMIT once the specialist hop returns, so a PERMIT satisfies
 * it. No other collapsing is allowed — the whole point is that HITL must not
 * satisfy STEP_UP.
 *
 * @param {string} expected
 * @param {string} actual
 */
function outcomeConforms(expected, actual) {
  if (expected === actual) return true;
  if (expected === 'DELEGATE_AND_EXECUTE' && actual === 'PERMIT') return true;
  return false;
}

/**
 * The chip use cases whose outcome can be compared for a vertical, deduped by
 * trigger text the same way every other catalog gate dedupes.
 *
 * @param {string} vertical
 * @returns {Array<{ id: string, useCaseId: string, title: string, track: string,
 *                   trigger: string, expected: string }>}
 */
function conformanceSubjects(vertical) {
  const out = [];
  const seen = new Set();
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (A2A_UNROUTABLE.test(t.text) || seen.has(t.text)) continue;
    if (!COMPARABLE_OUTCOMES.has(uc.expectedOutcome)) continue;
    seen.add(t.text);
    out.push({
      id: u.id,
      useCaseId: uc.useCaseId,
      title: uc.title,
      track: uc.track,
      trigger: t.text,
      expected: uc.expectedOutcome,
    });
  }
  return out;
}

/**
 * Summarize rows for the UI headline. `collapsed` is called out separately
 * because it is the failure that looks like success: several distinct controls
 * all reporting the same outcome renders as a tidy uniform table.
 *
 * @param {Array<{ ok: boolean, actual: string }>} rows
 */
function summarize(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.ok).length;
  const distinct = new Set(rows.map((r) => r.actual));
  return {
    total,
    passed,
    failed: total - passed,
    distinctOutcomes: distinct.size,
    collapsed: total > 1 && distinct.size === 1 ? [...distinct][0] : null,
  };
}

module.exports = {
  COMPARABLE_OUTCOMES,
  outcomeFromAgentResponse,
  outcomeConforms,
  conformanceSubjects,
  summarize,
  VERTICALS,
};
