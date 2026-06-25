jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  systemPromptFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/geminiNlIntent');

describe('geminiNlIntent buildSystem plugin routing', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses the plugin system prompt when a plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.systemPromptFor.mockReturnValue('PLUGIN SYSTEM PROMPT');
    const out = __test.buildSystem('health');
    // buildSystem prepends the SYSTEM_BASE JSON router rules so Helix still
    // emits JSON even for plugin verticals (c7acc130); the plugin prompt is
    // appended, not returned verbatim.
    expect(out).toContain('PLUGIN SYSTEM PROMPT');
    expect(dispatch.systemPromptFor).toHaveBeenCalled();
  });

  it('falls back to base+theme override when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = __test.buildSystem('banking');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(dispatch.systemPromptFor).not.toHaveBeenCalled();
  });
});
