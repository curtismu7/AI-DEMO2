'use strict';
/**
 * Agent reason-loop path, REAL vertical manifest + REAL verticalDispatch.
 *
 * `resolveExecuteTool` passes `executeBffTool` to `verticalDispatch.executeToolFor`
 * as the `legacy` callback. executeBffTool resolves tool names against banking's
 * registry (getBankingToolDefinitions) / the MCP pipeline, so before the fix a
 * plugin-less active vertical executed BANKING's tools.
 *
 * Live reproduction on main (instrumented leaf, real routing):
 *   processAgentMessage({ vertical: 'admin-console', message: 'spot any unusual activity' })
 *   -> [activity-prefetch] tool=get_my_transactions ... BANKING TOOLS EXECUTED: ["get_my_transactions"]
 *
 * `admin-console` is the only vertical in config/verticals/ with a manifest.json
 * but no index.js; `resolveVerticalRouting` also accepts any request-supplied
 * slug, so an unknown id lands in the same place.
 */

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async (a) => JSON.stringify({
    transactions: [{ id: 'txn-1', amount: -42.5, merchant: 'Whole Foods' }],
    tool: a.name,
  })),
  executeBffToolWithToken: jest.fn(),
}));
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => false),
  delegateToSpecialist: jest.fn(),
}));

const { verticalManifest } = require('../../services/verticalManifest');
const verticalDispatch = require('../../services/verticalDispatch');

describe('plugin inventory (real config/verticals)', () => {
  beforeAll(() => verticalManifest.init());

  it('admin-console is the only manifest vertical without a plugin', () => {
    const missing = verticalManifest.listAll()
      .map((v) => v.id)
      .filter((id) => verticalDispatch.resolvePlugin(id) === null);
    expect(missing).toEqual(['admin-console']);
  });
});

describe('resolveExecuteTool — plugin-less active vertical', () => {
  let executeBffTool;
  let __test;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ executeBffTool } = require('../../services/bffMcpToolExecutor'));
    ({ __test } = require('../../services/demoAgentLangGraphService'));
    verticalManifest.init();
  });

  it('does not run banking\'s get_my_transactions for admin-console', async () => {
    const exec = __test.resolveExecuteTool('admin-console', {
      userId: 'u1', userToken: 't', req: null, tokenEvents: [], sessionId: 's1',
    });
    const raw = await exec('get_my_transactions', {});

    expect(executeBffTool).not.toHaveBeenCalled();
    expect(raw).not.toMatch(/Whole Foods/);
    expect(raw).not.toMatch(/txn-1/);

    const parsed = JSON.parse(raw);
    expect(parsed.result.errorCode).toBe('vertical_no_plugin');
    expect(parsed.result.verticalId).toBe('admin-console');
    expect(parsed.result.error).toContain('admin-console');
  });

  it('still runs the tool for a vertical that HAS a plugin (banking is unaffected)', async () => {
    const exec = __test.resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: null, tokenEvents: [], sessionId: 's1',
    });
    // get_weather is advertised by banking but owned by MCP — banking's plugin
    // returns NOT_MY_TOOL, so the legacy (executeBffTool) MUST still be reached.
    await exec('get_weather', { city_name: 'Denver' });
    expect(executeBffTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'get_weather' }),
    );
  });
});
