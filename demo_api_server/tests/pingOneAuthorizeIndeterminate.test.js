'use strict';

/**
 * A LIVE P1AZ "INDETERMINATE" must fail closed, even carrying an obligation.
 *
 * The word is overloaded. This service manufactures 'INDETERMINATE' to mean
 * "PERMIT, pending a step-up/HITL/consent gate" (mcpToolPipeline turns it into a
 * 428). PingOne Authorize uses the same word to mean "I could not evaluate" —
 * a condition referenced an attribute the request never sent.
 *
 * The block gates in mcpToolAuthorizationService stop only on 'DENY'
 * (:986, :1102, :1312). So if a live INDETERMINATE reached them as
 * 'INDETERMINATE', the call would be treated as permitted-pending-MFA and would
 * proceed once the user satisfied a gate that was never the obstacle.
 *
 * Probed live 2026-08-03: create_withdrawal as PrivateBanking with no `Amount`
 * returns decision INDETERMINATE, because the tier cap comparison has no
 * operand. A missing request attribute must not widen access.
 */

const { _normalizeDecision } = require('../services/pingOneAuthorizeService');

describe('_normalizeDecision — live INDETERMINATE fails closed', () => {
  it('collapses a live INDETERMINATE to DENY when no obligation is present', () => {
    expect(_normalizeDecision({ decision: 'INDETERMINATE' })).toBe('DENY');
  });

  it('collapses a live INDETERMINATE to DENY EVEN WITH an obligation present', () => {
    // The regression. Before the fix this returned 'INDETERMINATE', which the
    // pipeline maps to a 428 step-up rather than a block.
    expect(_normalizeDecision({ decision: 'INDETERMINATE' }, { hasObligation: true })).toBe('DENY');
  });

  it('reads the effect from result/details the same way', () => {
    expect(_normalizeDecision({ result: { decision: 'indeterminate' } }, { hasObligation: true })).toBe('DENY');
    expect(_normalizeDecision({ details: { decision: 'Indeterminate' } }, { hasObligation: true })).toBe('DENY');
  });

  it('still lets the OBLIGATION-PENDING convention through for an unknown effect', () => {
    // This is the path the simulated engine and the legacy PDP rely on: no
    // recognisable effect string, but a gate to satisfy. It must stay
    // INDETERMINATE or UC7 step-up stops issuing its 428.
    expect(_normalizeDecision({}, { hasObligation: true })).toBe('INDETERMINATE');
    expect(_normalizeDecision({ decision: '' }, { hasObligation: true })).toBe('INDETERMINATE');
  });

  it('leaves PERMIT and DENY untouched', () => {
    expect(_normalizeDecision({ decision: 'PERMIT' })).toBe('PERMIT');
    expect(_normalizeDecision({ decision: 'DENY' }, { hasObligation: true })).toBe('DENY');
  });

  it('still fails closed on an unknown effect with no obligation', () => {
    expect(_normalizeDecision({ decision: 'SOMETHING_NEW' })).toBe('DENY');
    expect(_normalizeDecision(null)).toBe('DENY');
  });
});
