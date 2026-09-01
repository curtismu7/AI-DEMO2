'use strict';
/**
 * Gateway Showcase inspector source.
 *
 * The load-bearing behaviours, each of which was a live finding rather than a
 * guess:
 *
 *  - a DENY (403 + JSON-RPC error) is a RESULT, not a throw. It is the single
 *    most interesting thing the tab can show, and burying it as a transport
 *    failure defeats the point of the tab.
 *  - a non-2xx with NO JSON-RPC error body must surface as an error. Brave's
 *    rsFilter returns a bare 401 and the first cut rendered it as tool output,
 *    which looks like the call succeeded.
 *  - one server failing must not blank the other. Brave 401s while weather
 *    lists six tools; that is the normal state today.
 *  - only the door that needs a token gets one.
 */
const gw = require('../services/mcpInspectorGateway');

const OLD_URL = process.env.MCP_PINGGATEWAY_URL;
// global.fetch is saved and reassigned by hand rather than jest.spyOn'd.
// spyOn stacks: calling it again inside a second test wraps the FIRST spy, and
// restoreAllMocks then unwinds to a mock instead of the native function. In-band
// that leaks a stubbed fetch into every suite that runs after this file — it
// turned five unrelated suites red (clientRegistryPersistence, pingoneEventStore,
// mcpFacade, transactionConsentChallengeDavinci, webhookPingOne), all of which
// pass alone. An explicit save/restore cannot stack.
const REAL_FETCH = global.fetch;
beforeEach(() => { process.env.MCP_PINGGATEWAY_URL = 'https://gw.test:3036'; });
afterEach(() => {
  if (OLD_URL === undefined) delete process.env.MCP_PINGGATEWAY_URL;
  else process.env.MCP_PINGGATEWAY_URL = OLD_URL;
  global.fetch = REAL_FETCH;
  jest.restoreAllMocks();
});

/** Route fetch by URL so the two doors can behave differently, as they really do. */
function stubFetch(byPath) {
  global.fetch = jest.fn(async (url, opts) => {
    const hit = Object.entries(byPath).find(([p]) => String(url).includes(p));
    const { status = 200, body = {} } = hit ? hit[1] : { status: 404, body: {} };
    stubFetch.lastHeaders = opts.headers;
    if (!stubFetch.calls) stubFetch.calls = [];
    stubFetch.calls.push({ url: String(url), headers: opts.headers });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  });
  return global.fetch;
}

const toolsOk = (names) => ({ status: 200, body: { result: { tools: names.map((n) => ({ name: n })) } } });

describe('listGatewayTools', () => {
  test('tags each tool with its server so the tree can group them', async () => {
    stubFetch({
      '/mcp/weather': toolsOk(['get_weather', 'get_forecast']),
      '/mcp/brave': toolsOk(['brave_news_search']),
    });
    const { tools } = await gw.listGatewayTools();
    expect(tools.map((t) => `${t.server}/${t.name}`)).toEqual([
      'weather/get_weather',
      'weather/get_forecast',
      'brave/brave_news_search',
    ]);
    expect(tools[0].serverLabel).toBe('Weather MCP');
  });

  test('one server down does not blank the other', async () => {
    // The live state today: Brave 401s behind its rsFilter, weather lists fine.
    stubFetch({ '/mcp/weather': toolsOk(['get_weather']), '/mcp/brave': { status: 401, body: {} } });
    const { tools, servers } = await gw.listGatewayTools();
    expect(tools).toHaveLength(1);
    const brave = servers.find((s) => s.key === 'brave');
    expect(brave.error).toBe('HTTP 401');
    expect(brave.count).toBe(0);
  });

  test('a malformed tools/list is an error, not an empty server', async () => {
    // "No tools" and "we could not read the response" are different stories.
    stubFetch({ '/mcp/weather': { status: 200, body: { result: {} } }, '/mcp/brave': toolsOk([]) });
    const { servers } = await gw.listGatewayTools();
    expect(servers.find((s) => s.key === 'weather').error).toBe('Malformed tools/list response');
    expect(servers.find((s) => s.key === 'brave').error).toBeNull();
  });

  test('sends the Accept header PingGateway demands', async () => {
    // Omitting it returns 406, which reads exactly like a routing fault.
    stubFetch({ '/mcp/weather': toolsOk([]), '/mcp/brave': toolsOk([]) });
    await gw.listGatewayTools();
    expect(stubFetch.lastHeaders.Accept).toBe('application/json, text/event-stream');
  });

  test('only the door that needs a token asks for one', async () => {
    stubFetch.calls = [];
    stubFetch({ '/mcp/weather': toolsOk([]), '/mcp/brave': toolsOk([]) });
    const getToken = jest.fn().mockResolvedValue('tok-123');
    await gw.listGatewayTools({ getToken });
    expect(getToken).toHaveBeenCalledTimes(1);
    const weather = stubFetch.calls.find((c) => c.url.includes('/mcp/weather'));
    const brave = stubFetch.calls.find((c) => c.url.includes('/mcp/brave'));
    expect(weather.headers.Authorization).toBeUndefined();
    expect(brave.headers.Authorization).toBe('Bearer tok-123');
  });

  // NOT tested here: the "no gateway configured" guard. Reaching it needs
  // configStore stubbed, jest.spyOn does not take on its getEffective, and
  // doing it with jest.resetModules() + doMock POISONED OTHER SUITES — adding
  // this file made cimdRegisterRoute.wiring.test.js fail in-band, and it passes
  // without it. Resetting the module registry mid-run leaves other suites
  // holding stale instances. A three-line defensive guard is not worth a test
  // that can break 929 unrelated suites.
});

describe('invokeGatewayTool', () => {
  test('a policy DENY comes back as a result with denied:true', async () => {
    stubFetch({
      '/mcp/weather': {
        status: 403,
        body: { jsonrpc: '2.0', error: { code: -32000, message: 'Agent Gateway: Boston, MA is blocked by demo policy' } },
      },
    });
    const out = await gw.invokeGatewayTool({ server: 'weather', tool: 'get_weather', params: { city_name: 'Boston, MA' } });
    expect(out.denied).toBe(true);
    expect(out.status).toBe(403);
    expect(out.error).toMatch(/Boston, MA is blocked/);
    expect(out.errorCode).toBe(-32000);
  });

  test('a bare 401 is an error, NOT rendered as tool output', async () => {
    // Regression: the first cut fell through to `result: text`, so an auth
    // failure displayed in the output pane as though the call had worked.
    stubFetch({ '/mcp/brave': { status: 401, body: {} } });
    const out = await gw.invokeGatewayTool({ server: 'brave', tool: 'brave_news_search', params: {} });
    expect(out.result).toBeUndefined();
    expect(out.error).toMatch(/rsFilter/);
    expect(out.denied).toBeUndefined();
  });

  test('a permit returns the result and a timing', async () => {
    stubFetch({ '/mcp/weather': { status: 200, body: { result: { content: [{ type: 'text', text: 'Austin' }] } } } });
    const out = await gw.invokeGatewayTool({ server: 'weather', tool: 'get_weather', params: {} });
    expect(out.result.content[0].text).toBe('Austin');
    expect(typeof out.elapsedMs).toBe('number');
    expect(out.error).toBeUndefined();
  });

  test('an unknown server is refused rather than guessed at', async () => {
    const out = await gw.invokeGatewayTool({ server: 'nope', tool: 'x', params: {} });
    expect(out.error).toMatch(/Unknown gateway server/);
  });
});
