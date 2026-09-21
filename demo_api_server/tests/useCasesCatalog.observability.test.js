'use strict';

const { USE_CASES } = require('../config/useCases');

describe('Observability use case', () => {
  it('publishes UC20 as a first-class agent observability scenario', () => {
    const observability = USE_CASES.find((useCase) => useCase.id === 'UC20');

    expect(observability).toEqual(expect.objectContaining({
      useCaseId: 'audit-trail',
      title: 'Agent observability and traceability',
    }));
    expect(observability.evidence.activity).toEqual(
      expect.arrayContaining(['token', 'authorize', 'mcp']),
    );
    expect(observability.evidence.tokenChain).toEqual([
      'user-token',
      'token-exchange',
      'authorize-decision',
      'tool-dispatched',
    ]);
  });
});
