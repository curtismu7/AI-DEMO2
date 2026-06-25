// Plan 2 invariant guard: with retail active, every shared NL/agent path
// resolves from the retail plugin — never banking. Uses the REAL retail
// plugin (require) behind a mocked verticalManifest so verticalDispatch sees it
// as the active vertical's plugin.
// Load the REAL retail plugin first (it requires verticalManifest, which is
// fine — that runs before the mock below replaces the module for verticalDispatch).
const retailPlugin = require('../../config/verticals/retail/index.js');

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    plugins: {
      // Delegate to the real plugin captured via the global set in this file.
      get: (id) => (id === 'retail' ? global.__RETAIL_PLUGIN__ : null),
      has: (id) => id === 'retail',
    },
    resolver: { activeId: () => 'retail' },
  },
}));

global.__RETAIL_PLUGIN__ = retailPlugin;

const dispatch = require('../../services/verticalDispatch');

const BANKING_ACTION_NAMES = ['create_transfer', 'get_my_accounts', 'create_deposit', 'create_withdrawal', 'get_account_balance', 'get_my_transactions'];

describe('retail active — no banking fallback anywhere in the shared path', () => {
  it('tool schemas are retail actions only (no banking tool names)', () => {
    const legacy = () => { throw new Error('legacy must not run when a plugin is active'); };
    const names = dispatch.toolSchemasFor('retail', legacy).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_orders', 'order_status', 'rewards_balance', 'checkout']));
    for (const b of BANKING_ACTION_NAMES) expect(names).not.toContain(b);
  });

  it('heuristics map only to retail actions', () => {
    const toolNames = retailPlugin.getTools().map((t) => t.name);
    const actions = dispatch.heuristicsFor('retail', () => { throw new Error('legacy'); }).map((h) => h.action);
    for (const a of actions) expect(toolNames).toContain(a);
  });

  it('system prompt contains no banking action names and no "banking" word', () => {
    const prompt = dispatch.systemPromptFor('retail', {}, () => { throw new Error('legacy'); });
    expect(prompt).not.toMatch(/\bbank(ing)?\b/i);
    for (const b of BANKING_ACTION_NAMES) expect(prompt).not.toContain(b);
  });

  it('executeTool returns retail data, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('retail', 'rewards_balance', {}, { userId: 'u' }, () => { throw new Error('legacy'); });
    expect(out.result.points).toBeDefined();
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId|routingNumber/);
  });

  it('authz comes from the retail plugin (checkout gated)', () => {
    const authz = dispatch.authzFor('retail', () => { throw new Error('legacy'); });
    expect(authz.checkout).toEqual({ consent: true });
  });
});
