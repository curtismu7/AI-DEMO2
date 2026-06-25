// Plan 2 invariant guard: with workforce active, every shared NL/agent path
// resolves from the workforce plugin — never banking. Uses the REAL workforce
// plugin (require) behind a mocked verticalManifest so verticalDispatch sees it
// as the active vertical's plugin.
// Load the REAL workforce plugin first (it requires verticalManifest, which is
// fine — that runs before the mock below replaces the module for verticalDispatch).
const workforcePlugin = require('../../config/verticals/workforce/index.js');

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    plugins: {
      // Delegate to the real plugin captured via the global set in this file.
      get: (id) => (id === 'workforce' ? global.__WF_PLUGIN__ : null),
      has: (id) => id === 'workforce',
    },
    resolver: { activeId: () => 'workforce' },
  },
}));

global.__WF_PLUGIN__ = workforcePlugin;

const dispatch = require('../../services/verticalDispatch');

const BANKING_ACTION_NAMES = ['create_transfer', 'get_my_accounts', 'create_deposit', 'create_withdrawal', 'get_account_balance', 'get_my_transactions'];

describe('workforce active — no banking fallback anywhere in the shared path', () => {
  it('tool schemas are workforce actions only (no banking tool names)', () => {
    const legacy = () => { throw new Error('legacy must not run when a plugin is active'); };
    const names = dispatch.toolSchemasFor('workforce', legacy).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['view_benefits', 'pto_balance', 'list_expenses', 'submit_expense', 'request_time_off']));
    for (const b of BANKING_ACTION_NAMES) expect(names).not.toContain(b);
  });

  it('heuristics map only to workforce actions', () => {
    const toolNames = workforcePlugin.getTools().map((t) => t.name);
    const actions = dispatch.heuristicsFor('workforce', () => { throw new Error('legacy'); }).map((h) => h.action);
    for (const a of actions) expect(toolNames).toContain(a);
  });

  it('system prompt contains no banking action names and no "banking" word', () => {
    const prompt = dispatch.systemPromptFor('workforce', {}, () => { throw new Error('legacy'); });
    expect(prompt).not.toMatch(/\bbank(ing)?\b/i);
    for (const b of BANKING_ACTION_NAMES) expect(prompt).not.toContain(b);
  });

  it('executeTool returns workforce data, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('workforce', 'pto_balance', {}, { userId: 'u' }, () => { throw new Error('legacy'); });
    expect(out.result.balance).toBeDefined();
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId|routingNumber/);
  });

  it('authz comes from the workforce plugin (submit_expense stepUp+consent gated)', () => {
    const authz = dispatch.authzFor('workforce', () => { throw new Error('legacy'); });
    expect(authz.submit_expense).toEqual({ stepUp: true, consent: true });
  });
});
