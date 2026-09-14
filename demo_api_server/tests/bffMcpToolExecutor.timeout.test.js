// demo_api_server/tests/bffMcpToolExecutor.timeout.test.js
/**
 * bffMcpToolExecutor's tool-call legs now bound themselves instead of relying
 * entirely on the caller (TECH_DEBT.md, 2026-09-11 "bffMcpToolExecutor sets no
 * timeout of its own"). Two guarantees:
 *   1. Regression — a pipeline call that completes well within the timeout
 *      returns the exact same success shape as before this fix.
 *   2. Fix — a pipeline call that never settles is bounded (rejects with a
 *      clear, tool-named error) instead of hanging the caller forever.
 */
jest.mock('../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn(),
}));
jest.mock('../services/agentRunRegistry', () => ({
  startRun: jest.fn().mockReturnValue('run-1'),
  endRun: jest.fn(),
}));

const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
const { setPipelineDeps, executeBffTool } = require('../services/bffMcpToolExecutor');

describe('bffMcpToolExecutor — tool-call timeout', () => {
  const req = { sessionID: 'sess-1', session: { user: { id: 'u1' } } };

  beforeEach(() => {
    jest.clearAllMocks();
    setPipelineDeps({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a pipeline call that completes well within the timeout succeeds exactly as before', async () => {
    runMcpToolPipeline.mockResolvedValue({ kind: 'result', httpStatus: 200, body: { result: { ok: true } } });

    const raw = await executeBffTool({
      name: 'get_my_accounts', args: {}, req, userToken: 't', sessionId: 'sess-1', tokenEvents: [],
    });

    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  test('a pipeline call that hangs past the timeout is bounded, not left hanging forever', async () => {
    jest.useFakeTimers();
    runMcpToolPipeline.mockImplementation(() => new Promise(() => {})); // never settles

    const pending = executeBffTool({
      name: 'get_my_accounts', args: {}, req, userToken: 't', sessionId: 'sess-1', tokenEvents: [],
    });
    // Swallow the unhandled-rejection warning node would otherwise print for the
    // in-flight promise before the assertion below awaits it.
    pending.catch(() => {});

    await jest.advanceTimersByTimeAsync(25001);

    await expect(pending).rejects.toThrow(/"get_my_accounts" timed out \(25000ms\)/);
  });
});
