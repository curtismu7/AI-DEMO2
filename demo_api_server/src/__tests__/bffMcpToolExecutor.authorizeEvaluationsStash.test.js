// demo_api_server/src/__tests__/bffMcpToolExecutor.authorizeEvaluationsStash.test.js
//
// Final whole-branch review finding: bffMcpToolExecutor.js stashed only the
// SINGULAR mcpAuthorizeEvaluation field onto req, never the PLURAL
// mcpAuthorizeEvaluations array — so a run that hit both the McpFirstTool
// gate and the Transaction/Amount policy override on the agent-invoke path
// (the path that produced the original bug report) never surfaced its
// second Token Chain card. This proves the stash mirrors the singular field
// exactly, for both fields, at the exact site where executeBffTool reads
// the pipeline outcome.
'use strict';

jest.mock('../../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn(),
}));

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');
const { executeBffTool, setPipelineDeps } = require('../../services/bffMcpToolExecutor');

describe('executeBffTool stashes mcpAuthorizeEvaluations (plural) onto req, alongside the singular field', () => {
  beforeEach(() => {
    runMcpToolPipeline.mockReset();
    setPipelineDeps({});
  });

  test('outcome.body.mcpAuthorizeEvaluations reaches req._mcpAuthorizeEvaluations', async () => {
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'DENY', decisionId: 'limit-1', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    runMcpToolPipeline.mockResolvedValue({
      kind: 'block',
      httpStatus: 403,
      tokenEvents: [],
      body: {
        error: 'mcp_authorization_denied',
        mcpAuthorizeEvaluation: { decision: 'DENY', decisionId: 'limit-1' },
        mcpAuthorizeEvaluations: evaluations,
      },
    });
    const req = { body: {}, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'create_transfer', args: { amount: 2500 }, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });

    // Both fields stashed, mirroring each other exactly.
    expect(req._mcpAuthorizeEvaluation).toEqual({ decision: 'DENY', decisionId: 'limit-1' });
    expect(req._mcpAuthorizeEvaluations).toEqual(evaluations);
  });

  test('outcome.mcpAuthorizeEvaluations (top-level, not under body) also reaches req', async () => {
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'STEP_UP', decisionId: 'limit-2', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    runMcpToolPipeline.mockResolvedValue({
      kind: 'result',
      httpStatus: 200,
      tokenEvents: [],
      mcpAuthorizeEvaluation: { decision: 'PERMIT', decisionId: 'limit-2' },
      mcpAuthorizeEvaluations: evaluations,
      body: { result: 'ok' },
    });
    const req = { body: {}, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'create_transfer', args: { amount: 600 }, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });

    expect(req._mcpAuthorizeEvaluations).toEqual(evaluations);
  });

  test('no plural field on the outcome → req is never stamped with it', async () => {
    runMcpToolPipeline.mockResolvedValue({
      kind: 'result',
      httpStatus: 200,
      tokenEvents: [],
      body: { result: 'ok', mcpAuthorizeEvaluation: { decision: 'PERMIT', decisionId: 'd1' } },
    });
    const req = { body: {}, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });

    expect(req._mcpAuthorizeEvaluation).toEqual({ decision: 'PERMIT', decisionId: 'd1' });
    expect(req._mcpAuthorizeEvaluations).toBeUndefined();
  });
});
