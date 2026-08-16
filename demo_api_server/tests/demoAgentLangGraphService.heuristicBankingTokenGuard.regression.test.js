// demo_api_server/tests/demoAgentLangGraphService.heuristicBankingTokenGuard.regression.test.js
//
// Regression: the heuristic BANKING branch must not dispatch when the session
// has no user token (lazy-auth guests).
//
// Bug (#1445 fallout): isGuest need_auth ran only after the heuristic path.
// Vertical intents already guarded missing tokens; banking did not. Guests
// asking "show my balance" / "transfer $50…" got a bare ❌ tool-error reply
// with no need_auth, so the SPA never redirected to PingOne. branch_hours
// (public catalog) must stay open without a bearer.

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async () => JSON.stringify({ error: 'should_not_dispatch' })),
  executeBffToolWithToken: jest.fn(),
  callMcpToolAsAgent: jest.fn(),
  setPipelineDeps: jest.fn(),
  unwrapMcpResultEnvelope: jest.fn((x) => x),
  runPipelineForSim: jest.fn(),
}));

jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return {
    ...real,
    parseHeuristic: jest.fn(() => ({
      kind: 'banking',
      banking: { action: 'balance', params: {} },
    })),
  };
});

jest.mock('../services/oauthService', () => ({
  performTokenExchange: jest.fn(async () => 'minted-gw-token'),
}));
jest.mock('../services/platformAgentRuntime', () => ({
  runPlatformLoop: jest.fn(async () => ({ ok: true, status: 200, data: 'PLATFORM_OK' })),
  buildPlatformRequest: jest.fn(),
}));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://gw.example'),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const { executeBffTool } = require('../services/bffMcpToolExecutor');
const { performTokenExchange } = require('../services/oauthService');
const nlIntentParser = require('../services/nlIntentParser');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCfg({});
  nlIntentParser.parseHeuristic.mockReturnValue({
    kind: 'banking',
    banking: { action: 'balance', params: {} },
  });
});

describe('processAgentMessage — heuristic banking token guard (regression)', () => {
  test('no userToken on balance → clean need_auth and NO MCP dispatch', async () => {
    const result = await processAgentMessage({
      message: 'show my balance',
      userId: null,
      userToken: null,
      isGuest: true,
      req: { body: {}, tokenEvents: [] },
    });

    expect(result.success).toBe(false);
    expect(result.need_auth).toBe(true);
    expect(result.error).toBe('need_auth');
    expect(result.requiresLogin).toBe(true);
    expect(result.reply).toMatch(/sign in/i);

    expect(executeBffTool).not.toHaveBeenCalled();
    expect(performTokenExchange).not.toHaveBeenCalled();
  });

  test('branch_hours without token stays open (public catalog)', async () => {
    nlIntentParser.parseHeuristic.mockReturnValue({
      kind: 'banking',
      banking: { action: 'branch_hours', params: { city: 'Austin' } },
    });

    const result = await processAgentMessage({
      message: 'branch hours in Austin',
      userId: null,
      userToken: null,
      isGuest: true,
      req: { body: {}, tokenEvents: [] },
    });

    expect(result.need_auth).toBeUndefined();
    expect(result.error).not.toBe('need_auth');
    expect(result.success).toBe(true);
    expect(result.publicCatalog).toBe(true);
    expect(executeBffTool).not.toHaveBeenCalled();
  });

  test('with userToken → the no-token guard does NOT fire', async () => {
    const result = await processAgentMessage({
      message: 'show my balance',
      userId: 'u1',
      userToken: 'session-access-token',
      req: { body: {}, tokenEvents: [] },
    });

    expect(result.need_auth).toBeUndefined();
    expect(result.error).not.toBe('need_auth');
  });
});
