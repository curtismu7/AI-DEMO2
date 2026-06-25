jest.mock('../../services/verticalManifest', () => {
  const plugin = {
    getManifest: () => ({ id: 'health' }),
    getTools: () => [{ name: 'book_appointment', description: 'Book an appointment', inputSchema: { type: 'object' }, scopes: ['write'], authz: {} }],
    getHeuristics: () => [{ re: /book/, action: 'book_appointment' }],
    getSystemPrompt: () => 'You are a healthcare assistant. Never mention banking.',
    getDataStore: () => ({}),
    executeTool: async () => ({ result: { appointment: 'confirmed' }, render: { type: 'card' } }),
    getAuthz: () => ({ book_appointment: {} }),
  };
  const plugins = { get: (id) => (id === 'health' ? plugin : null), has: (id) => id === 'health' };
  return { verticalManifest: { plugins, resolver: { activeId: () => 'health' } } };
});

const dispatch = require('../../services/verticalDispatch');

describe('no banking fallback when a plugin is active', () => {
  it('tool schemas contain only the plugin tool names', () => {
    const legacy = () => { throw new Error('legacy must not be called'); };
    const schemas = dispatch.toolSchemasFor('health', legacy);
    expect(schemas.map((s) => s.name)).toEqual(['book_appointment']);
  });

  it('system prompt contains no banking action names', () => {
    const prompt = dispatch.systemPromptFor('health', {}, () => { throw new Error('legacy'); });
    for (const term of ['create_transfer', 'get_my_accounts']) {
      expect(prompt).not.toContain(term);
    }
  });

  it('heuristics map only to plugin actions', () => {
    const h = dispatch.heuristicsFor('health', () => { throw new Error('legacy'); });
    const actions = h.map((x) => x.action);
    for (const a of actions) expect(a).toBe('book_appointment');
  });

  it('executeTool returns the plugin result, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, () => { throw new Error('legacy'); });
    expect(out.result).toEqual({ appointment: 'confirmed' });
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId/);
  });
});
