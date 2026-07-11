// bankingAgentLangGraphService.reasoningUnavailable.test.js
//
// Regression for the 2026-07-11 live incident: on reasoning_unavailable the
// banking service returned the heuristics capability catalog as success:true,
// which misreported an LLM outage (e.g. the post-deploy llama model-load
// window) as "Heuristics-only mode" and sent debugging down the wrong path.
// It must return an honest error, mirroring demoAgentLangGraphService — and
// in llamacpp mode it must mention the model-load window.
//
// Mock set mirrors demoAgentLangGraphService.modes.test.js (hermetic, no IO).

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));
jest.mock('../services/platformAgentRuntime', () => ({
  runPlatformLoop: jest.fn(async () => ({ ok: true, status: 200, data: 'PLATFORM_OK' })),
  buildPlatformRequest: jest.fn(),
}));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://gw.example'),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchange: jest.fn(async () => 'minted-gw-token'),
}));
jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return {
    ...real,
    parseHeuristic: jest.fn(() => ({ kind: 'none' })),
  };
});
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async () => ({ ok: false, reason: 'reasoning_unavailable' })),
}));
jest.mock('../services/llmProviderResolver', () => ({
  resolveLlmProvider: jest.fn(
    jest.requireActual('../services/llmProviderResolver').resolveLlmProvider
  ),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const nlIntentParser = require('../services/nlIntentParser');
const { processAgentMessage } = require('../services/bankingAgentLangGraphService');

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

beforeEach(() => {
  jest.clearAllMocks();
  nlIntentParser.parseHeuristic.mockReturnValue({ kind: 'none' });
  resetCfg();
});

describe('processAgentMessage — reasoning_unavailable', () => {
  test('llamacpp mode: honest error with model-load hint, NOT the catalog as success', async () => {
    // Provider comes from langchainConfig here (the /nl route seeds it from the
    // mode picker; this service has no agent_mode provider fallback of its own).
    resetCfg({ agent_mode: 'llamacpp' });

    const result = await processAgentMessage({
      message: 'how is my portfolio doing',
      userId: 'u1',
      userToken: 'session-access-token',
      langchainConfig: { provider: 'llamacpp' },
      req: { body: {} },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('reasoning_unavailable');
    expect(result.reply).toContain('llamacpp');
    expect(result.reply).toContain('takes several minutes to load');
    // The old behavior: buildCatalogMessage() with success:true.
    expect(result.reply).not.toBe(nlIntentParser.buildCatalogMessage());
    expect(result.reply).not.toContain('Heuristics-only mode');
  });

  test('non-llamacpp provider: honest error without the local model-load hint', async () => {
    resetCfg({ agent_mode: 'gemini' });

    const result = await processAgentMessage({
      message: 'how is my portfolio doing',
      userId: 'u1',
      userToken: 'session-access-token',
      langchainConfig: { provider: 'google' },
      req: { body: {} },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('reasoning_unavailable');
    expect(result.reply).not.toContain('takes several minutes to load');
  });
});
