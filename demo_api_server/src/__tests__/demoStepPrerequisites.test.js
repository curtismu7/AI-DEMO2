// demo_api_server/src/__tests__/demoStepPrerequisites.test.js
'use strict';

const { USE_CASES, resolveUseCase } = require('../../config/useCases');
const {
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
  needsA2aCredentials,
  checkA2aCredentials,
  needsParConfig,
  checkParConfig,
  checkChipPrerequisites,
  PAR_CONFIG_KEYS,
} = require('../../services/demoStepPrerequisites');

describe('demoStepPrerequisites', () => {
  test('UC2 declares MCP gateway flags and needs Agent 2 credentials (no A2A flag — delegation is always on)', () => {
    const uc = resolveUseCase('UC2', 'banking');
    const flags = requiredFlagsForUseCase(uc);
    expect(flags).toEqual(expect.arrayContaining(['ff_mcp_gateway_pinggateway']));
    expect(flags).not.toContain('ff_a2a_delegation');
    expect(needsA2aCredentials(uc)).toBe(true);
  });

  test('UC2.5 (maturity works) needs only the MCP gateway runtime flags', () => {
    // PR #830 (83d8e0231c) gave UC2.5 a primaryTool ('get_portfolio_summary')
    // so the A2A explain modal has real Ping products/Authorize/Gateway copy
    // to show. ff_a2a_delegation was removed — delegation is always on — so
    // the gateway runtime flags are all that remains to arm.
    const uc = resolveUseCase('UC2.5', 'banking');
    expect(uc.maturity).toBe('works');
    expect(uc.primaryTool).toBe('get_portfolio_summary');
    const flags = requiredFlagsForUseCase(uc);
    expect(flags).toEqual(expect.arrayContaining(['ff_mcp_gateway_pinggateway']));
    expect(flags).not.toContain('ff_a2a_delegation');
  });

  test('requiredFlagsForUseCaseId resolves A2A slug to the gateway runtime flags only', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation', USE_CASES)).toEqual(
      expect.arrayContaining(['ff_mcp_gateway_pinggateway']),
    );
    expect(requiredFlagsForUseCaseId('a2a-delegation', USE_CASES)).not.toContain('ff_a2a_delegation');
  });

  test('requiredFlagsForUseCaseId resolves a2a-generalist-mismatch slug', () => {
    expect(requiredFlagsForUseCaseId('a2a-generalist-mismatch', USE_CASES)).toEqual(
      expect.arrayContaining(['ff_mcp_gateway_pinggateway']),
    );
  });

  test('UC1 MCP balance chip requires PingGateway brokered-exchange flags', () => {
    const uc = resolveUseCase('UC1', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(
      expect.arrayContaining([
        'ff_mcp_gateway_pinggateway',
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
    expect(r.errors.join(' ')).toMatch(/ff_mcp_gateway_pinggateway is off/);
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
          ? true
          : null
      ),
    };
    const r = checkChipPrerequisites(uc, 'banking', cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /credentials missing/i.test(e))).toBe(true);
  });

  test('non-A2A flag-gated chip requires maturity flag plus MCP gateway flags', () => {
    // UC22's maturity flag is 'ciba_enabled', not 'ff_ciba' — PR #832 aligned
    // useCases.js to the actual registered configStore key (featureFlags.js,
    // configStore.js, cibaService.js all read/write 'ciba_enabled'; 'ff_ciba'
    // was never a real flag and caused PATCH 400s).
    const uc = resolveUseCase('UC22', 'banking');
    expect(requiredFlagsForUseCase(uc)).toEqual(
      expect.arrayContaining([
        'ciba_enabled',
        'ff_mcp_gateway_pinggateway',
      ]),
    );
    expect(needsA2aCredentials(uc)).toBe(false);
  });

  test('UC14 / UC14b require PingOne PAR (RFC 9126) config', () => {
    const violation = resolveUseCase('UC14', 'banking');
    const verified = resolveUseCase('UC14b', 'banking');
    expect(needsParConfig(violation)).toBe(true);
    expect(needsParConfig(verified)).toBe(true);
    expect(PAR_CONFIG_KEYS).toEqual(
      expect.arrayContaining([
        'pingone_par_endpoint',
        'pingone_ai_agent_actor_client_id',
        'pingone_ai_agent_actor_client_secret',
        'pingone_ai_agent_actor_redirect_uri',
      ]),
    );
  });

  test('checkParConfig fails when PAR endpoint or actor redirect is empty', () => {
    const cfg = {
      getEffective: (k) => (
        k === 'pingone_ai_agent_actor_client_id' || k === 'pingone_ai_agent_actor_client_secret'
          ? 'set'
          : ''
      ),
    };
    const r = checkParConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'pingone_par_endpoint',
        'pingone_ai_agent_actor_redirect_uri',
      ]),
    );
  });

  test('checkChipPrerequisites aggregates missing PAR config for UC14b', () => {
    const uc = resolveUseCase('UC14b', 'banking');
    const cfg = {
      getEffective: (k) => (typeof k === 'string' && k.startsWith('ff_') ? true : null),
    };
    const r = checkChipPrerequisites(uc, 'banking', cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/PAR config missing/);
    expect(r.errors.join(' ')).toMatch(/pingone_par_endpoint/);
  });
});
