'use strict';
/**
 * A vertical with NO plugin must not execute another vertical's tools.
 *
 * `executeToolFor` used to fall through to the caller's `legacy` callback when
 * `resolvePlugin(activeId)` returned null. On the agent reason-loop path
 * (demoAgentLangGraphService.resolveExecuteTool) that callback is
 * `executeBffTool`, which resolves names against banking's tool registry — so
 * a plugin-less active vertical silently ran BANKING's tools. Proven live:
 * `processAgentMessage({ vertical: 'admin-console', message: 'spot any unusual
 * activity' })` executed banking's `get_my_transactions`.
 *
 * This is the SEVENTH site of the same coercion class closed by PRs #1214,
 * #1228 and #1232 — and the first one in the tool EXECUTION path rather than
 * the parser.
 *
 * The `NOT_MY_TOOL` fallthrough (a plugin explicitly disowning a tool name it
 * advertises, so the MCP executor can run it) is a DIFFERENT case and is
 * deliberately preserved — pinned below.
 */

jest.mock('../../services/verticalManifest', () => {
  const plugins = {
    _map: new Map(),
    get(id) { return this._map.get(id) || null; },
    has(id) { return !!this._map.get(id); },
  };
  return {
    verticalManifest: {
      plugins,
      resolver: { activeId: () => 'health' },
      listAll: () => [],
      init: () => {},
    },
  };
});

const { verticalManifest } = require('../../services/verticalManifest');
const dispatch = require('../../services/verticalDispatch');

const healthPlugin = {
  getManifest: () => ({ id: 'health' }),
  getTools: () => [{ name: 'book_appointment', description: 'Book', inputSchema: { type: 'object' } }],
  getHeuristics: () => [{ re: /book/, action: 'book_appointment' }],
  getSystemPrompt: () => 'health prompt',
  getDataStore: () => ({}),
  executeTool: async (name) => ({ result: { booked: name }, render: 'card' }),
  getAuthz: () => ({ book_appointment: { stepUp: true } }),
};

beforeEach(() => {
  verticalManifest.plugins._map.clear();
  verticalManifest.plugins._map.set('health', healthPlugin);
});

describe('executeToolFor — vertical with no plugin', () => {
  // The legacy callback the AGENT path actually passes (executeBffTool) runs
  // banking's tools. Standing in for it with a spy that returns banking data
  // makes the leak visible: if legacy is called at all, banking content is what
  // comes back.
  function bankingLegacy() {
    const spy = jest.fn(async (name) => ({
      result: { accounts: [{ id: 'acct-1', balance: 4210.55 }], tool: name },
      render: 'account_list',
    }));
    return spy;
  }

  it('does NOT call the legacy callback (which is banking\'s executor)', async () => {
    const legacy = bankingLegacy();
    await dispatch.executeToolFor('admin-console', 'get_my_transactions', {}, {}, legacy);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('returns no banking data for a plugin-less vertical', async () => {
    const legacy = bankingLegacy();
    const out = await dispatch.executeToolFor('admin-console', 'get_my_accounts', {}, {}, legacy);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/acct-1/);
    expect(json).not.toMatch(/4210\.55/);
    expect(out.result.accounts).toBeUndefined();
  });

  it('fails explicitly and names the vertical and the tool', async () => {
    const out = await dispatch.executeToolFor('admin-console', 'get_my_transactions', {}, {}, jest.fn());
    expect(out.result.error).toContain('admin-console');
    expect(out.result.error).toContain('get_my_transactions');
    expect(out.result.errorCode).toBe('vertical_no_plugin');
    expect(out.result.verticalId).toBe('admin-console');
    expect(out.result.tool).toBe('get_my_transactions');
    expect(out.result.noMatch).toBe(true);
    expect(out.render).toBe('text');
  });

  it('applies to ANY unknown vertical id, not just admin-console', async () => {
    const legacy = bankingLegacy();
    const out = await dispatch.executeToolFor('not-a-vertical', 'create_transfer', { amount: 500 }, {}, legacy);
    expect(legacy).not.toHaveBeenCalled();
    expect(out.result.verticalId).toBe('not-a-vertical');
    expect(out.result.errorCode).toBe('vertical_no_plugin');
  });

  it('still refuses for an admin caller (the admin overlay is not a substitute)', async () => {
    const legacy = bankingLegacy();
    const out = await dispatch.executeToolFor('admin-console', 'get_my_accounts', {}, { isAdmin: true }, legacy);
    expect(legacy).not.toHaveBeenCalled();
    expect(out.result.errorCode).toBe('vertical_no_plugin');
  });
});

describe('executeToolFor — behaviour that must NOT change', () => {
  it('dispatches to the plugin when one exists', async () => {
    const legacy = jest.fn();
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, legacy);
    expect(out).toEqual({ result: { booked: 'book_appointment' }, render: 'card' });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('NOT_MY_TOOL still falls through to legacy — banking advertises real MCP tool names', async () => {
    verticalManifest.plugins._map.set('banking', {
      ...healthPlugin,
      getManifest: () => ({ id: 'banking' }),
      executeTool: async () => dispatch.NOT_MY_TOOL,
    });
    const legacy = jest.fn(async (name) => ({ result: { mcp: name }, render: 'text' }));
    const out = await dispatch.executeToolFor('banking', 'get_weather', { city_name: 'x' }, {}, legacy);
    expect(legacy).toHaveBeenCalledWith('get_weather', { city_name: 'x' }, {});
    expect(out).toEqual({ result: { mcp: 'get_weather' }, render: 'text' });
  });

  it('a plugin throwing still becomes an {error} result, not a legacy fallthrough', async () => {
    verticalManifest.plugins._map.set('health', {
      ...healthPlugin,
      executeTool: async () => { throw new Error('boom'); },
    });
    const legacy = jest.fn();
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, legacy);
    expect(out.result.error).toMatch(/boom/);
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe('authzFor — vertical with no plugin', () => {
  it('never calls the legacy callback, so it cannot inherit banking authz', () => {
    const legacy = jest.fn(() => ({ create_transfer: { stepUp: true, consent: true } }));
    const authz = dispatch.authzFor('admin-console', {}, legacy);
    expect(legacy).not.toHaveBeenCalled();
    expect(authz).toEqual({});
    expect(authz.create_transfer).toBeUndefined();
  });

  it('still returns the plugin authz when a plugin exists', () => {
    const legacy = jest.fn(() => ({}));
    expect(dispatch.authzFor('health', {}, legacy)).toEqual({ book_appointment: { stepUp: true } });
    expect(legacy).not.toHaveBeenCalled();
  });
});
