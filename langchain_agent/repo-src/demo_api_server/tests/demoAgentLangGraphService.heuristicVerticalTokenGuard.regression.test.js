// demo_api_server/tests/demoAgentLangGraphService.heuristicVerticalTokenGuard.regression.test.js
//
// Regression: the heuristic VERTICAL branch must not dispatch an MCP tool call
// when the session has no user token.
//
// Bug: a matched vertical action (e.g. view_records) was dispatched even when
// userToken was empty. resolveMcpAccessTokenWithEvents then returned a null
// token, which the vertical path forwarded to the MCP gateway as an empty
// bearer — the gateway 401'd with "Empty JWT payload" and the user saw a raw
// gateway-auth error. The platform branch already guarded this case (`if
// (!userToken)`); the heuristic vertical branch did not. This locks in the
// mirrored guard: a clean need_auth, and NO dispatch (so no empty bearer ever
// reaches the gateway).

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

// Vertical MCP execution — assert it is NEVER reached on the no-token path.
jest.mock('../services/verticalMcpExecution', () => ({
  executePluginToolViaMcp: jest.fn(async () => ({ out: { result: {}, render: 'text' } })),
  checkLocalAuthzGate: jest.fn(() => null),
}));

// parseHeuristic mocked to force a matched vertical action.
jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return {
    ...real,
    parseHeuristic: jest.fn(() => ({ kind: 'vertical', action: 'view_records', params: {} })),
  };
});

// Keep the platform/LLM/exchange boundaries off the network in case any
// module-load side effect or fall-through reaches them (it must not on the
// guarded path).
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

const { executePluginToolViaMcp } = require('../services/verticalMcpExecution'); // asserted not-called on the guarded path
const { performTokenExchange } = require('../services/oauthService');
const nlIntentParser = require('../services/nlIntentParser');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCfg({}); // agent_mode unset → legacy heuristic path; ff_heuristic_enabled default (enabled).
  nlIntentParser.parseHeuristic.mockReturnValue({ kind: 'vertical', action: 'view_records', params: {} });
});

describe('processAgentMessage — heuristic vertical token guard (regression)', () => {
  test('no userToken → clean need_auth and NO MCP dispatch', async () => {
    const result = await processAgentMessage({
      message: 'view records',
      userId: 'u1',
      userToken: undefined, // session has no active bearer
      req: { body: {}, tokenEvents: [] },
    });

    // Clean need_auth instead of a raw gateway "Empty JWT payload" error.
    expect(result.success).toBe(false);
    expect(result.need_auth).toBe(true);
    expect(result.error).toBe('need_auth');
    expect(result.reply).toMatch(/sign in/i);

    // The empty bearer must never have been forwarded toward the gateway.
    expect(executePluginToolViaMcp).not.toHaveBeenCalled();
    expect(performTokenExchange).not.toHaveBeenCalled();
  });

  test('with userToken → the no-token guard does NOT fire', async () => {
    // Whatever dispatchVerticalIntent decides downstream (catalog, tool call,
    // etc.), the point is the missing-token guard is conditional: a present
    // token must never produce the need_auth short-circuit.
    const result = await processAgentMessage({
      message: 'view records',
      userId: 'u1',
      userToken: 'session-access-token',
      req: { body: {}, tokenEvents: [] },
    });

    expect(result.need_auth).toBeUndefined();
    expect(result.error).not.toBe('need_auth');
  });
});
