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
  test('UC2 declares ff_a2a_delegation, MCP gateway flags, and needs Agent 2 credentials', () => {
    const uc = resolveUseCase('UC2', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(
      expect.arrayContaining([
        'ff_a2a_delegation',
        'ff_mcp_gateway_pinggateway',
        'ff_gateway_brokered_exchange',
      ]),
    );
    expect(needsA2aCredentials(uc)).toBe(true);
  });

  test('UC2.5 (maturity works, no primaryTool) still requires ff_a2a_delegation', () => {
    const uc = resolveUseCase('UC2.5', 'banking');
    expect(uc.maturity).toBe('works');
    expect(uc.primaryTool).toBeFalsy();
    expect(requiredFlagsForUseCase(uc)).toEqual(['ff_a2a_delegation']);
  });

  test('requiredFlagsForUseCaseId resolves A2A slug without full catalog match extras', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation', USE_CASES)).toEqual(
      expect.arrayContaining(['ff_a2a_delegation']),
    );
  });

  test('UC1 MCP balance chip requires PingGateway brokered-exchange flags', () => {
    const uc = resolveUseCase('UC1', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(
      expect.arrayContaining([
        'ff_mcp_gateway_pinggateway',
        'ff_gateway_brokered_exchange',
      ]),
    );
  });

  test('checkChipPrerequisites fails when MCP gateway flags are off', () => {
    const uc = resolveUseCase('UC1', 'banking');
    const cfg = {
      getEffective: (k) => (k === 'ff_a2a_delegation' ? true : false),
    };
    const r = checkChipPrerequisites(uc, 'banking', cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ff_mcp_gateway_pinggateway is off/);
    expect(r.errors.join(' ')).toMatch(/ff_gateway_brokered_exchange is off/);
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
    const cfg = {
      getEffective: (k) => (
        k === 'ff_a2a_delegation'
        || k === 'ff_mcp_gateway_pinggateway'
        || k === 'ff_gateway_brokered_exchange'
          ? true
          : null
      ),
    };
    const r = checkChipPrerequisites(uc, 'banking', cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /credentials missing/i.test(e))).toBe(true);
  });

  test('non-A2A flag-gated chip requires maturity flag plus MCP gateway flags', () => {
    const uc = resolveUseCase('UC22', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(
      expect.arrayContaining([
        'ff_ciba',
        'ff_mcp_gateway_pinggateway',
        'ff_gateway_brokered_exchange',
      ]),
    );
    expect(needsA2aCredentials(uc)).toBe(false);
  });
});
