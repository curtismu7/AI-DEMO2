'use strict';

jest.mock('../config/admin/tools', () => ({
  buildAdminToolSchemas: jest.fn().mockResolvedValue([]),
  executeAdminTool: jest.fn().mockResolvedValue(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })),
}));
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn().mockImplementation(async ({ executeTool }) => {
    // Simulate the LLM calling one admin tool mid-loop.
    await executeTool('list_populations', {});
    return { ok: true, answer: 'Done.', inputTokens: 10, outputTokens: 5 };
  }),
  // adminAgentService.js also destructures withTruncationNotice from this module
  // and calls it on the success path — must be a real function or the happy path
  // throws (masked by processAdminMessage's outer try/catch, but that would make
  // this test pass for the wrong reason).
  withTruncationNotice: jest.fn((answer) => answer),
}));

const { processAdminMessage } = require('../services/adminAgentService');

test('processAdminMessage adds a pingone-admin-api Token Chain step for each admin tool call', async () => {
  const response = await processAdminMessage({
    message: 'list populations', userId: 'u1', sessionId: 's1', tokenEvents: [],
  });
  expect(response.success).toBe(true);
  const step = response.tokenEvents.find((e) => e.id === 'pingone-admin-api:list_populations');
  expect(step).toBeDefined();
  expect(step.status).toBe('success');
});
