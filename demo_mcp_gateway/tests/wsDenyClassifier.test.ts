'use strict';

/**
 * BUG #66 — the WS transport never surfaced the step-up obligation: a stepUp
 * decision fell through to the generic insufficient_scope error, so the agent
 * chased token scopes forever instead of triggering MFA. classifyWsDeny() is the
 * ordering decision the index.ts handler now routes through; this locks in that a
 * step-up decision maps to its own 'stepup' disposition, not 'insufficient_scope'.
 */

import { classifyWsDeny } from '../src/wsDenyClassifier';

describe('classifyWsDeny (WS tools/call deny disposition)', () => {
  it('BUG #66: a stepUp obligation maps to stepup, NOT insufficient_scope', () => {
    const authz = { obligation: 'stepUp', reason: 'STEP_UP_REQUIRED' };
    expect(classifyWsDeny(authz, false)).toBe('stepup');
  });

  it('step-up outranks a policy-not-found reason carried alongside it', () => {
    const authz = { obligation: 'stepUp', reason: 'no matching policy' };
    expect(classifyWsDeny(authz, false)).toBe('stepup');
  });

  it('an already-approved receipt does not re-trigger step-up (falls through)', () => {
    // A receipt cannot satisfy MFA, but parity with the HTTP path (&& !hitlApproved):
    // with hitlApproved the stepup branch is not taken.
    const authz = { obligation: 'stepUp', reason: 'STEP_UP_REQUIRED' };
    expect(classifyWsDeny(authz, true)).not.toBe('stepup');
  });

  it('HITL_REQUIRED still maps to hitl (unchanged)', () => {
    expect(classifyWsDeny({ reason: 'HITL_REQUIRED' }, false)).toBe('hitl');
  });

  it('a policy-drift reason maps to policy_not_found (unchanged)', () => {
    expect(classifyWsDeny({ reason: 'unknown_tool: no policy defined for tool X' }, false)).toBe('policy_not_found');
  });

  it('a plain scope denial maps to insufficient_scope (unchanged)', () => {
    expect(classifyWsDeny({ reason: 'insufficient token scopes' }, false)).toBe('insufficient_scope');
  });
});
