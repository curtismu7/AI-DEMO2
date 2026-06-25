jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  heuristicsFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { parseHeuristic } = require('../../services/nlIntentParser');

describe('parseHeuristic plugin routing', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses plugin heuristics (own action names) when a plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /book.*appointment/, action: 'book_appointment' }]);
    const out = parseHeuristic('please book an appointment', 'health');
    expect(out).toEqual({ kind: 'vertical', vertical: 'health', action: 'book_appointment', params: {} });
  });

  it('returns kind:none when plugin has no match (no banking fallback)', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /book.*appointment/, action: 'book_appointment' }]);
    const out = parseHeuristic('transfer 500 dollars', 'health');
    expect(out.kind).toBe('none');
  });

  it('falls back to legacy theme/banking routing when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = parseHeuristic('show my accounts', 'banking');
    expect(out.kind).toBe('banking');
  });
});
