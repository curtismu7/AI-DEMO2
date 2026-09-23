'use strict';

const { USE_CASES } = require('../../config/useCases');
const { __test } = require('../../services/agentMcpTokenService');

describe('PingFederate demo-step lane selection', () => {
  const idJagUseCase = 'enterprise-managed-mcp-authorization';
  const ordinaryUseCases = USE_CASES
    .map((useCase) => useCase.useCaseId)
    .filter((useCaseId) => useCaseId && useCaseId !== idJagUseCase);

  test('selects PF standard exchange for ordinary catalog steps and ID-JAG only for UC40', () => {
    expect(ordinaryUseCases.length).toBeGreaterThan(0);
    for (const useCaseId of ordinaryUseCases) {
      expect(__test.shouldUsePfIdJagForRun('pingfederate', useCaseId)).toBe(false);
      expect(__test.resolvePfExchangeMode('pingfederate', useCaseId)).toBe('standard');
    }
    expect(__test.shouldUsePfIdJagForRun('pingfederate', idJagUseCase)).toBe(true);
    expect(__test.resolvePfExchangeMode('pingfederate', idJagUseCase)).toBe('id-jag');
    expect(__test.shouldUsePfIdJagForRun('pingone', idJagUseCase)).toBe(false);
    expect(__test.resolvePfExchangeMode('pingone', idJagUseCase)).toBeNull();
  });

  test('keeps PF exchange and actor credentials separate from PingOne credentials', () => {
    const pf = {
      pf_standard_token_exchange_client_id: 'pf-standard-sentinel',
      pf_standard_token_exchange_client_secret: 'pf-standard-secret',
      pf_standard_token_exchange_token_endpoint_auth_method: 'post',
      pf_ai_agent_actor_client_id: 'pf-actor-sentinel',
      pf_ai_agent_actor_client_secret: 'pf-actor-secret',
      pf_ai_agent_actor_token_endpoint_auth_method: 'basic',
      pf_standard_token_exchange_actor_scope: 'agent:invoke',
      pingone_mcp_token_exchanger_client_id: 'p1-exchange-must-not-be-used',
      pingone_ai_agent_client_id: 'p1-actor-must-not-be-used',
    };
    const config = __test.resolvePfStandardExchangeConfig({ getEffective: (key) => pf[key] || '' });

    expect(config).toEqual({
      clientId: 'pf-standard-sentinel',
      clientSecret: 'pf-standard-secret',
      authMethod: 'post',
      actorClientId: 'pf-actor-sentinel',
      actorClientSecret: 'pf-actor-secret',
      actorAuthMethod: 'basic',
      actorScope: 'agent:invoke',
    });
  });
});
