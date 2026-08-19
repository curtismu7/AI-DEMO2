/**
 * @file authorizeObligations.test.js
 * Shared obligation classifier — the single source of truth both the simulated
 * AS and pingOneAuthorizeService use to map obligations -> enforcement flags.
 * Locks the H2 invariants: mutually-exclusive classification (consent wins
 * over generic HITL), highest-gate-wins (STEP_UP dominates), and the
 * informational `classified` breakdown.
 */

const {
  classifyObligation,
  classifyObligations,
} = require('../../services/authorizeObligations');

describe('classifyObligation (single obligation -> kind)', () => {
  it('maps STEP_UP and STEPUP variants to stepUp', () => {
    expect(classifyObligation({ type: 'STEP_UP' })).toBe('stepUp');
    expect(classifyObligation({ id: 'step_up_mfa' })).toBe('stepUp');
    expect(classifyObligation({ type: 'STEPUP' })).toBe('stepUp');
  });

  it('maps HITL_CONSENT to consent (NOT hitl) — most specific wins', () => {
    // The core H2 bug: HITL_CONSENT used to match both the HITL and consent
    // regexes. It must classify as consent only.
    expect(classifyObligation({ type: 'HITL_CONSENT' })).toBe('consent');
  });

  it('maps generic HITL / HUMAN_APPROVAL to hitl', () => {
    expect(classifyObligation({ type: 'HITL' })).toBe('hitl');
    expect(classifyObligation({ type: 'HUMAN_APPROVAL' })).toBe('hitl');
  });

  it('returns null for unknown / empty obligations', () => {
    expect(classifyObligation({ type: 'LOG_ONLY' })).toBeNull();
    expect(classifyObligation({})).toBeNull();
    expect(classifyObligation(null)).toBeNull();
  });

  // PingOne Authorize returns applied rule effects as `statements[].code` with
  // hyphenated codes (e.g. 'step-up-required'). The classifier must read `.code`
  // and normalize separators so these map the same as underscored types.
  it('reads the `code` field (PingOne statement shape)', () => {
    expect(classifyObligation({ code: 'HITL' })).toBe('hitl');
    expect(classifyObligation({ code: 'HITL_CONSENT' })).toBe('consent');
  });

  it('matches hyphenated step-up codes (step-up-required)', () => {
    expect(classifyObligation({ code: 'step-up-required' })).toBe('stepUp');
    expect(classifyObligation({ id: 'STEP-UP' })).toBe('stepUp');
  });

  it('matches hyphenated/spaced human-approval', () => {
    expect(classifyObligation({ code: 'human-approval' })).toBe('hitl');
  });

  it('benign PERMIT statement codes do not classify as a gate', () => {
    expect(classifyObligation({ code: 'transaction-approved' })).toBeNull();
    expect(classifyObligation({ code: 'mcp-tool-authorized' })).toBeNull();
  });
});

describe('classifyObligations (list -> highest-gate-wins flags)', () => {
  it('empty / non-array -> all flags false', () => {
    for (const input of [[], null, undefined, 'nope']) {
      const r = classifyObligations(input);
      expect(r).toMatchObject({
        stepUpRequired: false,
        hitlRequired: false,
        consentRequired: false,
      });
    }
  });

  it('STEP_UP alone -> stepUpRequired only', () => {
    const r = classifyObligations([{ type: 'STEP_UP' }]);
    expect(r.stepUpRequired).toBe(true);
    expect(r.hitlRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  it('HITL_CONSENT alone -> consentRequired only', () => {
    const r = classifyObligations([{ type: 'HITL_CONSENT' }]);
    expect(r.consentRequired).toBe(true);
    expect(r.hitlRequired).toBe(false);
    expect(r.stepUpRequired).toBe(false);
  });

  it('generic HITL alone -> hitlRequired only', () => {
    const r = classifyObligations([{ type: 'HITL' }]);
    expect(r.hitlRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
    expect(r.stepUpRequired).toBe(false);
  });

  it('STEP_UP + HITL_CONSENT -> step-up wins, ONLY stepUpRequired true', () => {
    // This is the parity-critical case: a $600 transfer matches both the
    // confirm and step-up thresholds. Highest gate wins — no double-gate.
    const r = classifyObligations([
      { type: 'HITL_CONSENT' },
      { type: 'STEP_UP' },
    ]);
    expect(r.stepUpRequired).toBe(true);
    expect(r.hitlRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  it('consent wins over generic HITL when both present (no step-up)', () => {
    const r = classifyObligations([
      { type: 'HITL' },
      { type: 'HITL_CONSENT' },
    ]);
    expect(r.consentRequired).toBe(true);
    expect(r.hitlRequired).toBe(false);
    expect(r.stepUpRequired).toBe(false);
  });

  it('keeps the informational `classified` breakdown (education, not enforcement)', () => {
    const r = classifyObligations([
      { type: 'HITL_CONSENT' },
      { type: 'STEP_UP' },
    ]);
    // Enforcement: step-up only. Breakdown: still records both.
    expect(r.stepUpRequired).toBe(true);
    expect(r.classified.stepUp).toHaveLength(1);
    expect(r.classified.consent).toHaveLength(1);
    expect(r.classified.hitl).toHaveLength(0);
  });

  it('ignores unrecognized obligations without affecting the winner', () => {
    const r = classifyObligations([
      { type: 'LOG_ONLY' },
      { type: 'HITL_CONSENT' },
      { id: 'audit' },
    ]);
    expect(r.consentRequired).toBe(true);
    expect(r.classified.consent).toHaveLength(1);
  });

  // Identifier-field parity with the Node gateway's classifier
  // (demo_mcp_gateway/src/auth/authorizeObligations.ts), which reads
  // type || id || code || name. `name` was missing here, and that divergence
  // failed in the DANGEROUS direction: an obligation carrying only `name`
  // gated on the gateway path and passed UNGATED on the BFF path, from the
  // same PDP response. Same class as the ELICITATION vocabulary gap #2133
  // fixed in the Groovy classifier.
  describe('identifier field parity with the gateway classifier', () => {
    it.each([
      ['name', { name: 'STEP_UP' }, 'stepUpRequired'],
      ['type', { type: 'STEP_UP' }, 'stepUpRequired'],
      ['id', { id: 'STEP_UP' }, 'stepUpRequired'],
      ['code', { code: 'step-up-required' }, 'stepUpRequired'],
    ])('classifies an obligation identified only by %s', (_field, ob, flag) => {
      expect(classifyObligations([ob])[flag]).toBe(true);
    });

    it('classifies every pause kind carried under name alone', () => {
      expect(classifyObligations([{ name: 'HITL_CONSENT' }]).consentRequired).toBe(true);
      expect(classifyObligations([{ name: 'HITL' }]).hitlRequired).toBe(true);
      expect(classifyObligations([{ name: 'ELICITATION' }]).elicitationRequired).toBe(true);
    });

    // The phase-2 wire shape from demo_authz_server carries obligatory/fulfilled
    // alongside the identifier. Neither is read, deliberately: the recorded trap
    // (llm-path-approval-gate-open) is that `obligatory: false` is NOT safe to
    // treat as optional, so ignoring both fields fails CLOSED. Pinned so a later
    // phase cannot start honouring them without this test going red first.
    it('gates on a phase-2 shaped obligation regardless of obligatory/fulfilled', () => {
      const phase2 = { id: 'STEP_UP', type: 'STEP_UP', obligatory: true, fulfilled: false };
      expect(classifyObligations([phase2]).stepUpRequired).toBe(true);

      const notObligatory = { ...phase2, obligatory: false, fulfilled: true };
      expect(classifyObligations([notObligatory]).stepUpRequired).toBe(true);
    });
  });
});
