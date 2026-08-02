'use strict';
/**
 * Ninth banking-coercion site: the UC34 activity pre-fetch SELECTED banking's
 * read tool for any vertical missing from READ_PRIMARY_TOOL_BY_VERTICAL.
 *
 *   demoAgentLangGraphService.js:1816
 *   READ_PRIMARY_TOOL_BY_VERTICAL[activeId] || 'get_my_transactions'
 *
 * PR #1250 stopped a PLUGIN-LESS vertical executing banking's tools, but a
 * vertical that HAS a plugin returning NOT_MY_TOOL still falls through to the
 * `legacy` executor — which on the agent path is executeBffTool, banking's
 * registry. `airlines` (merged 2026-08-02) is exactly that shape: it is
 * MCP-backed, so config/verticals/airlines/index.js:91 returns NOT_MY_TOOL for
 * every non-stub name. Absent from the map + NOT_MY_TOOL = banking's
 * transactions injected into an airlines session's prompt.
 *
 * Live reproduction before the fix (real processAgentMessage, LLM + BFF
 * executor stubbed, every routing decision between them production code):
 *
 *   vertical=airlines  message="spot any unusual activity"
 *   bff=["get_my_transactions"]  toolsCalled=["get_my_transactions"]
 *   prompt: "...already retrieved for you via get_my_transactions...
 *            2026-07-01 | debit | -42.5 |"
 *
 * The map is not a lookup-with-a-default. A miss must yield NO tool, never
 * another vertical's — otherwise every vertical added from now on inherits the
 * bug until someone remembers to edit config/useCases.js.
 */

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async (a) => JSON.stringify({
    transactions: [
      { id: 'BANKING-TXN-MARKER', date: '2026-07-01', type: 'debit', amount: -42.5, merchant: 'Whole Foods' },
    ],
    tool: a.name,
  })),
  executeBffToolWithToken: jest.fn(),
}));
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => false),
  delegateToSpecialist: jest.fn(),
}));
// Leaf stub: capture what the model would have been handed, run nothing.
jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async ({ messages }) => {
    global.__capturedMessages = messages;
    return { ok: true, answer: 'ok', toolsCalled: [], inputTokens: 0, outputTokens: 0 };
  }),
}));

const ACTIVITY_PROMPT = 'spot any unusual activity';
const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

/**
 * setup.js resets the module registry after every test, so everything a test
 * touches must be require()'d inside that test — a file-scope handle is a
 * different instance from the one the service under test resolves, and its
 * verticalManifest is never init()'d (every plugin then looks absent).
 */
function load() {
  const verticalManifest = require('../../services/verticalManifest').verticalManifest;
  verticalManifest.init();
  const configStore = require('../../services/configStore');
  // The pre-fetch lives on the LLM/reason-loop path. Test defaults are
  // agent_mode=heuristics, which returns the capability catalog long before it
  // — without this override the assertions pass vacuously.
  const realGet = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_heuristic_enabled') return 'false';
    if (k === 'agent_mode') return 'llamacpp';
    return realGet(k);
  });
  return {
    verticalManifest,
    verticalDispatch: require('../../services/verticalDispatch'),
    service: require('../../services/demoAgentLangGraphService'),
    executeBffTool: require('../../services/bffMcpToolExecutor').executeBffTool,
    READ_PRIMARY_TOOL_BY_VERTICAL: require('../../config/useCases').READ_PRIMARY_TOOL_BY_VERTICAL,
  };
}

function runAgent(service, vertical) {
  global.__capturedMessages = null;
  return service.processAgentMessage({
    message: ACTIVITY_PROMPT,
    vertical,
    userId: 'u1',
    userToken: 'tok',
    sessionId: 's1',
    tokenEvents: [],
    langchainConfig: {},
    req: { session: { active_vertical: vertical }, tokenEvents: [] },
  });
}

describe('activity pre-fetch — no vertical borrows another vertical\'s read tool', () => {
  // The structural claim. Every vertical missing from the map used to resolve to
  // banking's tool; after the fix a miss resolves to nothing. This is what makes
  // the class impossible rather than fixing today's instances.
  it('a vertical absent from READ_PRIMARY_TOOL_BY_VERTICAL selects NO tool', () => {
    const { service, READ_PRIMARY_TOOL_BY_VERTICAL } = load();
    for (const id of ['airlines', 'oauth-teaching', 'pingone-admin', 'admin-console', 'pizza']) {
      expect(READ_PRIMARY_TOOL_BY_VERTICAL[id]).toBeUndefined();
      expect(service.__test.readPrimaryToolFor(id)).toBeNull();
    }
  });

  it('banking still selects its own tool, and mapped verticals still select theirs', () => {
    const { service } = load();
    expect(service.__test.readPrimaryToolFor('banking')).toBe('get_my_transactions');
    expect(service.__test.readPrimaryToolFor('healthcare')).toBe('view_coverage');
    expect(service.__test.readPrimaryToolFor('retail')).toBe('list_orders');
  });

  // Guards the exact shape that made airlines live: plugin present, returns
  // NOT_MY_TOOL, absent from the map. A future vertical of this shape is the
  // only way this class can come back.
  it('airlines is the live case — MCP-backed plugin that disowns unknown names', async () => {
    const { verticalDispatch, READ_PRIMARY_TOOL_BY_VERTICAL } = load();
    expect(verticalDispatch.hasPlugin('airlines')).toBe(true);
    const p = verticalDispatch.resolvePlugin('airlines');
    expect(await p.executeTool('get_my_transactions', {}, {})).toBe(NOT_MY_TOOL);
    expect(READ_PRIMARY_TOOL_BY_VERTICAL.airlines).toBeUndefined();
  });

  // End-to-end through the REAL processAgentMessage: only the LLM and the BFF
  // tool executor are stubbed; every routing decision between them is production
  // code. Before the fix this injected a real banking transaction row into an
  // airlines session's user turn.
  it('does not inject banking transactions into an airlines session', async () => {
    const { service, executeBffTool } = load();
    const res = await runAgent(service, 'airlines');

    expect(executeBffTool.mock.calls.map((c) => c[0]?.name)).not.toContain('get_my_transactions');

    const prompt = JSON.stringify(global.__capturedMessages || []);
    expect(prompt).not.toMatch(/BANKING-TXN-MARKER/);
    expect(prompt).not.toMatch(/Whole Foods/);
    expect(prompt).not.toMatch(/get_my_transactions/);

    expect(res.toolsCalled || []).not.toContain('get_my_transactions');
  });

  it('still pre-fetches for a mapped vertical (healthcare keeps its own tool)', async () => {
    const { service, executeBffTool } = load();
    const res = await runAgent(service, 'healthcare');

    expect(executeBffTool.mock.calls.map((c) => c[0]?.name)).toContain('view_coverage');
    expect(res.toolsCalled).toContain('view_coverage');
    expect(JSON.stringify(global.__capturedMessages)).toMatch(/via view_coverage/);
  });
});
