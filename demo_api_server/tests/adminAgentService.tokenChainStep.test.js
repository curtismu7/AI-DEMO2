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
const { executeAdminTool } = require('../config/admin/tools');

test('processAdminMessage adds a pingone-admin-api Token Chain step for each admin tool call', async () => {
  const response = await processAdminMessage({
    message: 'list populations', userId: 'u1', sessionId: 's1', tokenEvents: [],
  });
  expect(response.success).toBe(true);
  const step = response.tokenEvents.find((e) => e.id === 'pingone-admin-api:list_populations');
  expect(step).toBeDefined();
  expect(step.status).toBe('success');
});

test('processAdminMessage marks the Token Chain step failed when executeAdminTool resolves with an error payload', async () => {
  // executeAdminTool never rejects on a real PingOne API failure — its catch
  // block resolves with a JSON-stringified { error, message } string instead
  // (config/admin/tools.js). The Token Chain step must reflect that as a
  // failure, not a success, even though the promise resolved.
  executeAdminTool.mockResolvedValueOnce(
    JSON.stringify({ error: 'pingone_mcp_unavailable', message: 'PingOne API timeout' }),
  );

  const response = await processAdminMessage({
    message: 'list populations', userId: 'u1', sessionId: 's1', tokenEvents: [],
  });

  const step = response.tokenEvents.find((e) => e.id === 'pingone-admin-api:list_populations');
  expect(step).toBeDefined();
  expect(step.status).toBe('failed');
  expect(step.explanation).toContain('PingOne API timeout');
});
