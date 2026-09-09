'use strict';
const {
  USE_CASES, resolveUseCase, getUseCaseGroupRequirement,
} = require('../config/useCases');

const ELIGIBLE = [
  'banking', 'sporting-goods', 'healthcare', 'retail', 'abercrombie-fitch',
  'investment', 'manufacturing', 'government', 'university', 'workforce',
  'admin', 'airlines',
];

test('the lever reads in/out and ignores anything else', () => {
  expect(getUseCaseGroupRequirement('entitlement-tiered-capability')).toBe('in');
  expect(getUseCaseGroupRequirement('group-entitlement-check')).toBe('out');
  expect(getUseCaseGroupRequirement('delegated-access-with-proof')).toBeNull();
  expect(getUseCaseGroupRequirement(null)).toBeNull();
});

test('UC9 declares DENY_403 and UC21 declares PERMIT', () => {
  expect(USE_CASES.find((u) => u.id === 'UC9').expectedOutcome).toBe('DENY_403');
  expect(USE_CASES.find((u) => u.id === 'UC21').expectedOutcome).toBe('PERMIT');
});

// The whole point: no amount, so no threshold gate can pre-empt the group
// decision and no payment can consume the single seeded bill UC22 needs.
test.each(ELIGIBLE)('%s: neither trigger carries a dollar amount', (v) => {
  for (const id of ['UC9', 'UC21']) {
    const uc = USE_CASES.find((u) => u.id === id);
    const text = (resolveUseCase(id, v) || uc).trigger.text;
    expect(text).not.toMatch(/\$\s?\d/);
  }
});
