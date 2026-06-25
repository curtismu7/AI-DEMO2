// Plan 2 invariant guard: with sporting-goods active, every shared NL/agent path
// resolves from the sporting-goods plugin — never banking. Uses the REAL sporting-goods
// plugin (require) behind a mocked verticalManifest so verticalDispatch sees it
// as the active vertical's plugin.
// Load the REAL sporting-goods plugin first (it requires verticalManifest, which is
// fine — that runs before the mock below replaces the module for verticalDispatch).
const sgPlugin = require('../../config/verticals/sporting-goods/index.js');

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    plugins: {
      // Delegate to the real plugin captured via the global set in this file.
      get: (id) => (id === 'sporting-goods' ? global.__SG_PLUGIN__ : null),
      has: (id) => id === 'sporting-goods',
    },
    resolver: { activeId: () => 'sporting-goods' },
  },
}));

global.__SG_PLUGIN__ = sgPlugin;

const dispatch = require('../../services/verticalDispatch');

const BANKING_ACTION_NAMES = ['create_transfer', 'get_my_accounts', 'create_deposit', 'create_withdrawal', 'get_account_balance', 'get_my_transactions'];

describe('sporting-goods active — no banking fallback anywhere in the shared path', () => {
  it('tool schemas are sporting-goods actions only (no banking tool names)', () => {
    const legacy = () => { throw new Error('legacy must not run when a plugin is active'); };
    const names = dispatch.toolSchemasFor('sporting-goods', legacy).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_gear', 'list_rentals', 'gear_order_status', 'loyalty_balance', 'extend_rental']));
    for (const b of BANKING_ACTION_NAMES) expect(names).not.toContain(b);
  });

  it('heuristics map only to sporting-goods actions', () => {
    const toolNames = sgPlugin.getTools().map((t) => t.name);
    const actions = dispatch.heuristicsFor('sporting-goods', () => { throw new Error('legacy'); }).map((h) => h.action);
    for (const a of actions) expect(toolNames).toContain(a);
  });

  it('system prompt contains no banking action names and no "banking" word', () => {
    const prompt = dispatch.systemPromptFor('sporting-goods', {}, () => { throw new Error('legacy'); });
    expect(prompt).not.toMatch(/\bbank(ing)?\b/i);
    for (const b of BANKING_ACTION_NAMES) expect(prompt).not.toContain(b);
  });

  it('executeTool returns sporting-goods data, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('sporting-goods', 'loyalty_balance', {}, { userId: 'u' }, () => { throw new Error('legacy'); });
    expect(out.result.points).toBeDefined();
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId|routingNumber/);
  });

  it('authz comes from the sporting-goods plugin (extend_rental gated)', () => {
    const authz = dispatch.authzFor('sporting-goods', () => { throw new Error('legacy'); });
    expect(authz.extend_rental).toEqual({ consent: true });
  });
});
