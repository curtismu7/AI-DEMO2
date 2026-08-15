'use strict';

// This repo's global src/__tests__/setup.js calls jest.resetModules() in its
// own afterEach, which invalidates any top-level `require()` reference to a
// mocked module — adminAgentService.js lazy-requires agentReasoningClient
// INSIDE processAdminMessage, so after a reset that lazy require resolves to
// a fresh mock instance distinct from one captured at file-load time. Fix:
// re-require inside beforeEach, after the prior test's reset has already run.
jest.mock('../config/admin/tools', () => ({
  buildAdminToolSchemas: jest.fn().mockResolvedValue([]),
  executeAdminTool: jest.fn().mockResolvedValue(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })),
}));
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn().mockResolvedValue({ ok: true, answer: 'Done.', inputTokens: 1, outputTokens: 1 }),
  withTruncationNotice: jest.fn((answer) => answer),
}));
jest.mock('../services/mcpPingOneHttpAdapter', () => ({
  getWorkerTokenDecoded: jest.fn().mockResolvedValue(null),
}));

// The message must NOT match a pingone-admin heuristic ("list applications"
// did): heuristic-first routing answers those without any LLM, so the
// provider-selection contract under test — WHEN the model runs, it is
// llamacpp — needs a phrase that actually reaches the reason loop.
describe('processAdminMessage — LLM provider selection', () => {
  let processAdminMessage;
  let runReasonLoop;

  beforeEach(() => {
    processAdminMessage = require('../services/adminAgentService').processAdminMessage;
    runReasonLoop = require('../services/agentReasoningClient').runReasonLoop;
  });

  test('always requests llamacpp, regardless of session langchainConfig', async () => {
    await processAdminMessage({
      message: 'please summarize our identity security posture',
      userId: 'u1',
      sessionId: 's1',
      tokenEvents: [],
      langchainConfig: { provider: 'helix', model: 'some-helix-model' },
    });
    expect(runReasonLoop).toHaveBeenCalledTimes(1);
    expect(runReasonLoop.mock.calls[0][0].provider).toBe('llamacpp');
  });

  test('requests llamacpp with an empty langchainConfig too', async () => {
    await processAdminMessage({
      message: 'please summarize our identity security posture', userId: 'u1', sessionId: 's1', tokenEvents: [],
    });
    expect(runReasonLoop).toHaveBeenCalledTimes(1);
    expect(runReasonLoop.mock.calls[0][0].provider).toBe('llamacpp');
  });
});
