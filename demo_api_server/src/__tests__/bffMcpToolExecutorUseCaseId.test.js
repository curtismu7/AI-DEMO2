// demo_api_server/src/__tests__/bffMcpToolExecutorUseCaseId.test.js
'use strict';

jest.mock('../../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn(),
}));

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');
const { executeBffTool, setPipelineDeps } = require('../../services/bffMcpToolExecutor');

describe('executeBffTool resolves useCaseId before invoking the pipeline', () => {
  beforeEach(() => {
    runMcpToolPipeline.mockReset();
    runMcpToolPipeline.mockResolvedValue({ kind: 'result', httpStatus: 200, tokenEvents: [], body: { result: {} } });
    setPipelineDeps({});
  });

  test('client-supplied useCaseId reaches ctx.useCaseId', async () => {
    const req = { body: { useCaseId: 'delegated-access-with-proof' }, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof');
  });

  test('an invalid client-supplied useCaseId is ignored in favor of the organic derivation', async () => {
    const req = { body: { useCaseId: 'not-a-real-slug' }, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof'); // deriveUseCaseId('get_balance', {}) fallback
  });

  test('no client-supplied id falls back to organic derivation', async () => {
    const req = { body: {}, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof');
  });
});
