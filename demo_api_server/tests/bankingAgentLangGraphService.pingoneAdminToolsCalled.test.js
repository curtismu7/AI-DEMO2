// bankingAgentLangGraphService.pingoneAdminToolsCalled.test.js
//
// The PingOne Admin success return hardcoded `toolsCalled: []`, so the vertical
// reported zero tool calls even after the reason loop had executed five.
// ProofStrip and step-verification read that field, so a run with real tool
// dispatch looked like a run with none.
//
// runReasonLoop already reports the tools it executed (agentReasoningClient.js
// pushes every call.name and returns `toolsCalled` when non-empty); the caller
// just threw it away.
//
// Mock set mirrors bankingAgentLangGraphService.reasoningUnavailable.test.js.

'use strict';

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://gw.example'),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchange: jest.fn(async () => 'minted-gw-token'),
}));
jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return { ...real, parseHeuristic: jest.fn(() => ({ kind: 'none' })) };
});
jest.mock('../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(async () => [
    { name: 'listUsers', description: 'List users', inputSchema: { type: 'object', properties: {} } },
    { name: 'listPopulations', description: 'List populations', inputSchema: { type: 'object', properties: {} } },
  ]),
  callTool: jest.fn(async () => ({ ok: true })),
}));
// processAgentMessage lazy-requires agentReasoningClient, and setup.js calls
// jest.resetModules() after every test — a fresh registry would hand it a fresh
// jest.fn() with no implementation. Hold the loop result outside the factory so
// the re-created mock still reads the value this test set.
const mockLoopResult = { value: null };
jest.mock('../services/agentReasoningClient', () => {
  const real = jest.requireActual('../services/agentReasoningClient');
  return { ...real, runReasonLoop: jest.fn(async () => mockLoopResult.value) };
});
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const { processAgentMessage } = require('../services/bankingAgentLangGraphService');

const FIVE_TOOLS = ['listUsers', 'listPopulations', 'listApplications', 'getEnvironment', 'getUser'];

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

function invoke() {
  return processAgentMessage({
    message: 'List the users in my PingOne environment',
    userId: 'u1',
    userToken: 'session-access-token',
    langchainConfig: { provider: 'pingone-admin' },
    req: { body: {} },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCfg();
  mockLoopResult.value = null;
});

describe('processAgentMessage — pingone-admin reports the tools it called', () => {
  test('toolsCalled carries every tool the reason loop executed', async () => {
    mockLoopResult.value = {
      ok: true,
      answer: 'Here are the users.',
      toolsCalled: [...FIVE_TOOLS],
      inputTokens: 10,
      outputTokens: 20,
    };

    const result = await invoke();

    expect(result.success).toBe(true);
    expect(result.toolsCalled).toEqual(FIVE_TOOLS);
    expect(result.toolsCalled.length).toBeGreaterThan(0);
  });

  test('toolsCalled is [] — never undefined — when no tool ran', async () => {
    // runReasonLoop omits the key entirely on a no-tool run (same convention as
    // `truncated`), so the caller must default it rather than pass it through.
    mockLoopResult.value = {
      ok: true,
      answer: 'Nothing to call.',
      inputTokens: 1,
      outputTokens: 2,
    };

    const result = await invoke();

    expect(result.success).toBe(true);
    expect(result.toolsCalled).toEqual([]);
  });
});
