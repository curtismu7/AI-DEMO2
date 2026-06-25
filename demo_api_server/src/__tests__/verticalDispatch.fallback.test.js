jest.mock('../../services/verticalManifest', () => {
  const plugins = { _map: new Map(), get(id) { return this._map.get(id) || null; }, has(id) { return !!this._map.get(id); } };
  return { verticalManifest: { plugins, resolver: { activeId: () => global.__ACTIVE__ } } };
});

const { verticalManifest } = require('../../services/verticalManifest');
const dispatch = require('../../services/verticalDispatch');

const fakePlugin = {
  getManifest: () => ({ id: 'health' }),
  getTools: () => [{ name: 'book_appointment', description: 'Book', inputSchema: { type: 'object' }, scopes: ['write'], authz: { stepUp: true } }],
  getHeuristics: () => [{ re: /book/, action: 'book_appointment' }],
  getSystemPrompt: (ctx) => `health prompt role=${ctx && ctx.role}`,
  getDataStore: () => ({}),
  executeTool: async (name) => ({ result: { booked: name }, render: { type: 'card' } }),
  getAuthz: () => ({ book_appointment: { stepUp: true } }),
};

beforeEach(() => { verticalManifest.plugins._map.clear(); });

describe('verticalDispatch — plugin present', () => {
  beforeEach(() => { global.__ACTIVE__ = 'health'; verticalManifest.plugins._map.set('health', fakePlugin); });

  it('hasPlugin true', () => { expect(dispatch.hasPlugin('health')).toBe(true); });

  it('heuristicsFor returns plugin heuristics, never the legacy callback', () => {
    const legacy = jest.fn(() => [{ re: /never/, action: 'banking_transfer' }]);
    const out = dispatch.heuristicsFor('health', legacy);
    expect(out).toEqual(fakePlugin.getHeuristics());
    expect(legacy).not.toHaveBeenCalled();
  });

  it('systemPromptFor returns plugin prompt, passing ctx', () => {
    const legacy = jest.fn(() => 'BANKING PROMPT');
    const out = dispatch.systemPromptFor('health', { role: 'admin' }, legacy);
    expect(out).toBe('health prompt role=admin');
    expect(legacy).not.toHaveBeenCalled();
  });

  it('toolSchemasFor returns plugin tools mapped to {name,description,inputSchema}', () => {
    const legacy = jest.fn(() => [{ name: 'create_transfer' }]);
    const out = dispatch.toolSchemasFor('health', legacy);
    expect(out).toEqual([{ name: 'book_appointment', description: 'Book', inputSchema: { type: 'object' } }]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('executeToolFor dispatches to plugin.executeTool', async () => {
    const legacy = jest.fn();
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, legacy);
    expect(out).toEqual({ result: { booked: 'book_appointment' }, render: { type: 'card' } });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('authzFor returns plugin authz', () => {
    const legacy = jest.fn(() => ({}));
    expect(dispatch.authzFor('health', legacy)).toEqual({ book_appointment: { stepUp: true } });
  });
});

describe('verticalDispatch — no plugin (legacy fallback)', () => {
  beforeEach(() => { global.__ACTIVE__ = 'retail'; });

  it('hasPlugin false', () => { expect(dispatch.hasPlugin('retail')).toBe(false); });

  it('heuristicsFor calls the legacy callback', () => {
    const legacy = jest.fn(() => 'LEGACY');
    expect(dispatch.heuristicsFor('retail', legacy)).toBe('LEGACY');
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it('systemPromptFor calls the legacy callback with ctx', () => {
    const legacy = jest.fn(() => 'LEGACY PROMPT');
    expect(dispatch.systemPromptFor('retail', { role: 'user' }, legacy)).toBe('LEGACY PROMPT');
    expect(legacy).toHaveBeenCalledWith({ role: 'user' });
  });

  it('executeToolFor calls the legacy callback', async () => {
    const legacy = jest.fn(async () => 'LEGACY RESULT');
    expect(await dispatch.executeToolFor('retail', 'create_transfer', { a: 1 }, {}, legacy)).toBe('LEGACY RESULT');
    expect(legacy).toHaveBeenCalledWith('create_transfer', { a: 1 }, {});
  });
});

describe('executeToolFor — plugin error becomes an {error} result (no reject)', () => {
  beforeEach(() => { global.__ACTIVE__ = 'health'; verticalManifest.plugins._map.set('health', { ...fakePlugin, executeTool: async () => { throw new Error('boom'); } }); });
  it('returns {result:{error}} instead of rejecting', async () => {
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, () => {});
    expect(out.result.error).toMatch(/boom/);
  });
});
