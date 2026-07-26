'use strict';

/**
 * The sweep's classification rules.
 *
 * These encode lessons that were learned the expensive way:
 *  - a chip dispatched by the UI cannot be scored through the API path, and
 *    scoring it there produces BOTH false passes and false failures
 *  - a use case that is deliberately unrunnable is not a failure
 *  - an unrecognised error must stay visible rather than collapse into "other"
 */

const {
  CAUSE,
  CLIENT_DISPATCHED_ACTIONS,
  LLM_ANALYSIS_UNROUTABLE,
  classifyReason,
  dispatchClassification,
} = require('../../scripts/useCaseSweepCauses');

const chip = (over = {}) => ({
  id: 'UC1',
  maturity: 'works',
  primaryTool: 'get_my_accounts',
  trigger: { type: 'chip', text: 'show my balance' },
  ...over,
});

describe('dispatchClassification', () => {
  test('a normal tool-dispatching chip is scorable', () => {
    const r = dispatchClassification(chip(), 'accounts');
    expect(r.scorable).toBe(true);
    expect(r.cause).toBeNull();
  });

  test('a client-dispatched action is NOT scorable via the API path', () => {
    // The real case: UC33 "show my mortgage" routes through AIAgent.js
    // `case "mortgage_demo"`, which calls the gateway tool itself. Driving it via
    // /api/agent/invoke falls through to the LLM, which answered correctly on two
    // runs and with a generic greeting on a third — so the API path can report a
    // working chip as broken, and a broken one as fine.
    const r = dispatchClassification(chip({ id: 'UC33' }), 'mortgage_demo');
    expect(r.scorable).toBe(false);
    expect(r.cause).toBe(CAUSE.CLIENT_DISPATCHED);
    expect(r.note).toMatch(/dispatched by the UI/);
  });

  test('every client-dispatched action is recognised', () => {
    for (const action of CLIENT_DISPATCHED_ACTIONS) {
      expect(dispatchClassification(chip(), action).cause).toBe(CAUSE.CLIENT_DISPATCHED);
    }
  });

  test('free-form LLM-analysis use cases are exempt, not broken', () => {
    for (const id of LLM_ANALYSIS_UNROUTABLE) {
      const r = dispatchClassification(chip({ id, primaryTool: null }), null);
      expect(r.scorable).toBe(false);
      expect(r.cause).toBe(CAUSE.LLM_ANALYSIS);
    }
  });

  test('needs-build maturity is not-runnable, never a failure', () => {
    const r = dispatchClassification(chip({ maturity: 'needs-build' }), 'accounts');
    expect(r.scorable).toBe(false);
    expect(r.cause).toBe(CAUSE.NOT_RUNNABLE);
  });

  test('flag-gated maturity is still runnable — the flag is a prereq, not a bar', () => {
    expect(dispatchClassification(chip({ maturity: 'flag:ff_rar' }), 'accounts').scorable).toBe(true);
  });

  test('a chip with no primaryTool is flagged, not silently scored', () => {
    const r = dispatchClassification(chip({ id: 'UCX', primaryTool: null }), 'accounts');
    expect(r.cause).toBe(CAUSE.NO_PRIMARY_TOOL);
  });
});

describe('classifyReason', () => {
  test('recognises the multi-resource scope refusal', () => {
    const r = classifyReason('invalid_scope: May not request scopes for multiple resources');
    expect(r.detail).toBe('invalid_scope_multi_resource');
    expect(r.hint).toMatch(/exactly ONE PingOne resource/);
  });

  test.each([
    ['Audience mismatch: got [x]', 'invalid_aud'],
    ['SCOPE_MISMATCH: user scopes', 'scope_mismatch'],
    ['403 insufficient_scope', 'insufficient_scope'],
    ['policy_not_found', 'policy_not_found'],
    ['user_lookup_failed: sub=abc', 'user_lookup_failed'],
    ['-32602 Unknown tool: foo', 'unknown_tool'],
    ['Delegation chain validation failed.', 'delegation_chain_broken'],
  ])('classifies %s', (text, expected) => {
    expect(classifyReason(text).detail).toBe(expected);
  });

  test('an unrecognised reason stays visible rather than collapsing to "other"', () => {
    const r = classifyReason('some brand new failure nobody has seen');
    expect(r.detail).toMatch(/^unmatched:/);
    expect(r.detail).toContain('some brand new failure');
  });

  test('an empty reason is still explicit', () => {
    expect(classifyReason('').detail).toBe('unmatched:(empty)');
  });
});
