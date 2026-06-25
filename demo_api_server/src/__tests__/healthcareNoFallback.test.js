// Plan 2 invariant guard: with healthcare active, every shared NL/agent path
// resolves from the healthcare plugin — never banking. Uses the REAL healthcare
// plugin (require) behind a mocked verticalManifest so verticalDispatch sees it
// as the active vertical's plugin.
// Load the REAL healthcare plugin first (it requires verticalManifest, which is
// fine — that runs before the mock below replaces the module for verticalDispatch).
const healthcarePlugin = require('../../config/verticals/healthcare/index.js');

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    plugins: {
      // Delegate to the real plugin captured via the global set in this file.
      get: (id) => (id === 'healthcare' ? global.__HC_PLUGIN__ : null),
      has: (id) => id === 'healthcare',
    },
    resolver: { activeId: () => 'healthcare' },
  },
}));

global.__HC_PLUGIN__ = healthcarePlugin;

const dispatch = require('../../services/verticalDispatch');

const BANKING_ACTION_NAMES = ['create_transfer', 'get_my_accounts', 'create_deposit', 'create_withdrawal', 'get_account_balance', 'get_my_transactions'];

describe('healthcare active — no banking fallback anywhere in the shared path', () => {
  it('tool schemas are healthcare actions only (no banking tool names)', () => {
    const legacy = () => { throw new Error('legacy must not run when a plugin is active'); };
    const names = dispatch.toolSchemasFor('healthcare', legacy).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['view_records', 'view_coverage', 'list_appointments', 'book_appointment', 'release_records']));
    for (const b of BANKING_ACTION_NAMES) expect(names).not.toContain(b);
  });

  it('heuristics map only to healthcare actions', () => {
    const toolNames = healthcarePlugin.getTools().map((t) => t.name);
    const actions = dispatch.heuristicsFor('healthcare', () => { throw new Error('legacy'); }).map((h) => h.action);
    for (const a of actions) expect(toolNames).toContain(a);
  });

  it('system prompt contains no banking action names and no "banking" word', () => {
    const prompt = dispatch.systemPromptFor('healthcare', {}, () => { throw new Error('legacy'); });
    expect(prompt).not.toMatch(/\bbank(ing)?\b/i);
    for (const b of BANKING_ACTION_NAMES) expect(prompt).not.toContain(b);
  });

  it('executeTool returns healthcare data, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('healthcare', 'view_coverage', {}, { userId: 'u' }, () => { throw new Error('legacy'); });
    expect(out.result.plan).toBeDefined();
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId|routingNumber/);
  });

  it('authz comes from the healthcare plugin (release_records gated)', () => {
    const authz = dispatch.authzFor('healthcare', () => { throw new Error('legacy'); });
    expect(authz.release_records).toEqual({ stepUp: true, consent: true });
  });
});
