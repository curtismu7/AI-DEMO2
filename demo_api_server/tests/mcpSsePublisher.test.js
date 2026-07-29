'use strict';

jest.mock('../services/mcpFlowSseHub', () => ({ publish: jest.fn() }));

const mcpFlowSseHub = require('../services/mcpFlowSseHub');
const { publishMcpResultToSse } = require('../services/mcpSsePublisher');

describe('publishMcpResultToSse — authorize evaluation fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes mcpAuthorizeEvaluation and mcpAuthorizeEvaluations when passed', () => {
    const evaluation = { decision: 'PERMIT', decisionId: 'gate-1' };
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'DENY', decisionId: 'limit-1', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    publishMcpResultToSse('trace-1', {
      tool: 'create_transfer', result: { content: [] }, durationMs: 42, isDelegated: true,
      requestJson: { amount: 2500 },
      mcpAuthorizeEvaluation: evaluation,
      mcpAuthorizeEvaluations: evaluations,
    });
    expect(mcpFlowSseHub.publish).toHaveBeenCalledTimes(1);
    const [traceId, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(traceId).toBe('trace-1');
    expect(payload.mcpAuthorizeEvaluation).toEqual(evaluation);
    expect(payload.mcpAuthorizeEvaluations).toEqual(evaluations);
  });

  it('omits both fields when neither is passed (existing callers unaffected)', () => {
    publishMcpResultToSse('trace-2', {
      tool: 'get_my_accounts', result: { content: [] }, durationMs: 10, isDelegated: false,
      requestJson: {},
    });
    const [, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluation');
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluations');
  });

  it('omits mcpAuthorizeEvaluations when only the singular field is passed (single-decision case)', () => {
    publishMcpResultToSse('trace-3', {
      tool: 'get_my_accounts', result: { content: [] }, durationMs: 10, isDelegated: false,
      requestJson: {},
      mcpAuthorizeEvaluation: { decision: 'PERMIT', decisionId: 'd1' },
    });
    const [, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(payload.mcpAuthorizeEvaluation).toEqual({ decision: 'PERMIT', decisionId: 'd1' });
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluations');
  });

  it('still no-ops when flowTraceId is falsy, even with authorize fields passed', () => {
    publishMcpResultToSse(null, {
      tool: 'get_my_accounts', result: {}, durationMs: 1, isDelegated: false,
      mcpAuthorizeEvaluation: { decision: 'PERMIT' },
    });
    expect(mcpFlowSseHub.publish).not.toHaveBeenCalled();
  });
});
