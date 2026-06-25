jest.mock('../../services/verticalDispatch', () => ({ hasPlugin: jest.fn(), toolSchemasFor: jest.fn() }));
const dispatch = require('../../services/verticalDispatch');
const router = require('../../routes/agentRun');
const { resolveAgentRunTools } = router.__test;

describe('agentRun resolveAgentRunTools', () => {
  beforeEach(() => jest.clearAllMocks());
  it('uses vertical plugin schemas when a plugin is active', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.toolSchemasFor.mockReturnValue([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
    const out = resolveAgentRunTools([{ name: 'get_my_accounts' }], 'healthcare');
    expect(out.map((t) => t.name)).toEqual(['book_appointment']);
    expect(dispatch.toolSchemasFor).toHaveBeenCalled();
  });
  it('keeps the passed-in (banking) tools when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = resolveAgentRunTools([{ name: 'get_my_accounts' }], 'banking');
    expect(out.map((t) => t.name)).toEqual(['get_my_accounts']);
    expect(dispatch.toolSchemasFor).not.toHaveBeenCalled();
  });
});
