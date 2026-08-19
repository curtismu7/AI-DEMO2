'use strict';
// INDETERMINATE-rework phase 3b (BFF pass-through audit): the shared classifier
// enforces ELICITATION, but pingOneAuthorizeService's unrecognised-gate warning
// predicate did not know it — a phase-2 `{type:'ELICITATION'}` obligation was
// enforced AND simultaneously warned as "Unrecognised — not enforced". A false
// alarm on the exact warning that exists to catch renamed/unknown gate codes
// trains people to ignore it. This pins predicate/classifier agreement.

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
  isReadOnly: jest.fn(() => true),
}));

const { _classifyRawObligations } = require('../../services/pingOneAuthorizeService');

describe('_classifyRawObligations vs the unrecognised-gate warning', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warnSpy.mockRestore());

  const unrecognisedWarned = () =>
    warnSpy.mock.calls.some((c) => String(c[0]).includes('Unrecognised obligation'));

  test('an ELICITATION obligation is enforced and NOT warned as unrecognised', () => {
    const flags = _classifyRawObligations({
      decision: 'INDETERMINATE',
      obligations: [{ id: 'elicitation-confirm', type: 'ELICITATION', obligatory: true, fulfilled: false }],
    });
    expect(flags.elicitationRequired).toBe(true);
    expect(unrecognisedWarned()).toBe(false);
  });

  test('every kind the classifier enforces is exempt from the warning', () => {
    for (const type of ['STEP_UP', 'HITL_CONSENT', 'HITL', 'HUMAN_APPROVAL', 'ELICITATION']) {
      warnSpy.mockClear();
      const flags = _classifyRawObligations({ decision: 'INDETERMINATE', obligations: [{ type }] });
      const enforced = flags.stepUpRequired || flags.hitlRequired || flags.consentRequired || flags.elicitationRequired;
      expect(enforced).toBe(true);
      expect(unrecognisedWarned()).toBe(false);
    }
  });

  test('a genuinely unknown obligation type still warns (the signal survives)', () => {
    const flags = _classifyRawObligations({
      decision: 'PERMIT',
      obligations: [{ type: 'QUANTUM_APPROVAL' }],
    });
    expect(flags.stepUpRequired || flags.hitlRequired || flags.consentRequired || flags.elicitationRequired).toBe(false);
    expect(unrecognisedWarned()).toBe(true);
  });
});
