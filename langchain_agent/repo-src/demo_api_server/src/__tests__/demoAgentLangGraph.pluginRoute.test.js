jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  toolSchemasFor: jest.fn(),
  executeToolFor: jest.fn(),
  isPluginToolName: jest.fn(() => false),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('agent reason-loop plugin routing helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolveToolSchemas uses plugin schemas when plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.toolSchemasFor.mockReturnValue([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
    const out = __test.resolveToolSchemas('health', { terminology: {} });
    expect(out).toEqual([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
  });

  it('resolveToolSchemas falls back to legacy builder when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = __test.resolveToolSchemas('banking', { terminology: { accounts: 'accounts' } });
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((t) => t.name === 'get_my_accounts')).toBe(true);
  });

  it('resolveExecuteTool dispatches to plugin executeTool when plugin exists', async () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.executeToolFor.mockResolvedValue({ result: { ok: 1 }, render: null });
    const exec = __test.resolveExecuteTool('health', { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    const out = await exec('book_appointment', { when: 'tomorrow' });
    expect(dispatch.executeToolFor).toHaveBeenCalledWith('health', 'book_appointment', { when: 'tomorrow' }, expect.any(Object), expect.any(Function));
    expect(typeof out).toBe('string');
    expect(JSON.parse(out)).toEqual({ result: { ok: 1 }, render: null });
  });
});
