jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  heuristicsFor: jest.fn(),
  resolvePlugin: jest.fn(() => null),
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

  it('does not let a mode:direct chip message resolve via heuristic matching, even if a heuristic would otherwise match it', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    // Broad enough to match the direct chip's message if the guard didn't stop it first.
    dispatch.heuristicsFor.mockReturnValue([{ re: /health record/, action: 'view_health_record' }]);
    const verticalCtx = {
      chips: [{ message: 'show my health record', mode: 'direct' }],
    };
    const out = parseHeuristic('show my health record', 'banking', verticalCtx);
    // 'direct' chips dispatch straight to their own tool/denyTool and never reach
    // the NL parser (extractChips.js) — heuristic matching must not capture them.
    expect(out.kind).toBe('none');
  });

  it('still resolves via heuristic when a both-mode chip shares its exact message text with a direct-mode chip (e.g. a "Direct MCP" demo chip reusing a real chip\'s wording)', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /list my orders/, action: 'list_orders' }]);
    const verticalCtx = {
      chips: [
        { message: 'list my orders', mode: 'both' },
        { message: 'list my orders', mode: 'direct' },
      ],
    };
    const out = parseHeuristic('list my orders', 'retail', verticalCtx);
    expect(out.kind).not.toBe('none');
  });

  it('still lets an unrelated message through to heuristic matching when a direct chip exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /book.*appointment/, action: 'book_appointment' }]);
    const verticalCtx = {
      chips: [{ message: 'show my health record', mode: 'direct' }],
    };
    const out = parseHeuristic('please book an appointment', 'health', verticalCtx);
    expect(out).toEqual({ kind: 'vertical', vertical: 'health', action: 'book_appointment', params: {} });
  });
});
