// demo_api_server/tests/bffMcpToolExecutor.runRegistry.test.js
jest.mock('../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn().mockResolvedValue({ kind: 'result', httpStatus: 200, body: { result: 'ok' } }),
}));
jest.mock('../services/agentRunRegistry', () => ({
  startRun: jest.fn().mockReturnValue('run-fixed-1'),
  endRun: jest.fn(),
}));

const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
const agentRunRegistry = require('../services/agentRunRegistry');
const { setPipelineDeps, executeBffTool } = require('../services/bffMcpToolExecutor');

describe('bffMcpToolExecutor — active-run registry bracketing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('executeBffTool starts a run before the pipeline call and ends it after', async () => {
    setPipelineDeps({});
    const req = { sessionID: 'sess-1', session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'reorder', args: {}, req, userToken: 't', sessionId: 'sess-1', tokenEvents: [] });

    expect(agentRunRegistry.startRun).toHaveBeenCalledWith(
      expect.stringMatching(/^session:[0-9a-f]{16}$/),
      { tool: 'reorder', userId: 'u1' },
    );
    expect(agentRunRegistry.endRun).toHaveBeenCalledWith('run-fixed-1');
    const startOrder = agentRunRegistry.startRun.mock.invocationCallOrder[0];
    const pipelineOrder = runMcpToolPipeline.mock.invocationCallOrder[0];
    const endOrder = agentRunRegistry.endRun.mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(pipelineOrder);
    expect(endOrder).toBeGreaterThan(pipelineOrder);
  });

  test('endRun still fires when the pipeline call throws', async () => {
    runMcpToolPipeline.mockRejectedValueOnce(new Error('boom'));
    setPipelineDeps({});
    const req = { sessionID: 'sess-2', session: { user: { id: 'u2' } } };
    await expect(
      executeBffTool({ name: 'create_transfer', args: {}, req, userToken: 't', sessionId: 'sess-2', tokenEvents: [] }),
    ).rejects.toThrow('boom');
    expect(agentRunRegistry.endRun).toHaveBeenCalledWith('run-fixed-1');
  });
});
