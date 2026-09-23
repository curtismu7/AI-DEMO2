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

});
