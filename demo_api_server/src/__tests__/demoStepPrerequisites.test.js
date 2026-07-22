// demo_api_server/src/__tests__/demoStepPrerequisites.test.js
'use strict';

const { USE_CASES, resolveUseCase } = require('../../config/useCases');
const {
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
  needsA2aCredentials,
  checkA2aCredentials,
  checkChipPrerequisites,
} = require('../../services/demoStepPrerequisites');

describe('demoStepPrerequisites', () => {
  test('UC2 declares ff_a2a_delegation and needs Agent 2 credentials', () => {
    const uc = resolveUseCase('UC2', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(['ff_a2a_delegation']);
    expect(needsA2aCredentials(uc)).toBe(true);
  });

  test('UC2.5 (maturity works) still requires ff_a2a_delegation', () => {
    const uc = resolveUseCase('UC2.5', 'banking');
    expect(uc.maturity).toBe('works');
    expect(requiredFlagsForUseCase(uc)).toEqual(['ff_a2a_delegation']);
  });

  test('requiredFlagsForUseCaseId resolves A2A slug without full catalog match extras', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation', USE_CASES)).toEqual([
      'ff_a2a_delegation',
    ]);
  });

  test('checkA2aCredentials fails when Agent 2 id/secret empty', () => {
    const cfg = { getEffective: () => '' };
    const r = checkA2aCredentials('banking', cfg);
    expect(r.required).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.specialistName).toMatch(/Investment Advisor/i);
  });

  test('checkChipPrerequisites aggregates missing Agent 2 credentials', () => {
    const uc = resolveUseCase('UC2', 'banking');
    const cfg = { getEffective: () => null };
    const r = checkChipPrerequisites(uc, 'banking', cfg);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/credentials missing/i);
  });

  test('non-A2A flag-gated chip only requires its maturity flag', () => {
    const uc = resolveUseCase('UC22', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(['ff_ciba']);
    expect(needsA2aCredentials(uc)).toBe(false);
  });
});
