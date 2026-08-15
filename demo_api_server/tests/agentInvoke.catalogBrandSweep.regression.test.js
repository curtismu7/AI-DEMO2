// demo_api_server/tests/agentInvoke.catalogBrandSweep.regression.test.js
//
// Content-asserting sweep (chip-correctness rule 1: assert a VALUE, or you
// have tested nothing). Every vertical's UC24 catalog chip — the REAL chip
// phrase from config/useCases.js, parsed by the REAL heuristic parser, through
// the REAL processAgentMessage dispatch — must answer with that vertical's own
// locations, and never Super Banking outside banking. The 2026-08-04
// regression passed every pipeline-level check because those asserted status
// and routing, not content.

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases.js');
const { CATALOG_BY_VERTICAL } = require('../data/publicBranchCatalog.js');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');

const UC24 = USE_CASES.find((u) => u.id === 'UC24');

describe('UC24 catalog chip — every vertical answers with its OWN locations', () => {
  test('sweep covers every vertical (new vertical must be added to the catalog)', () => {
    for (const v of VERTICALS) {
      expect(CATALOG_BY_VERTICAL[v]).toBeDefined();
      expect(CATALOG_BY_VERTICAL[v].length).toBeGreaterThan(0);
    }
  });

  test.each(VERTICALS)('%s', async (vertical) => {
    const resolved = resolveUseCase(UC24.id, vertical) || UC24;
    const chipText = resolved.trigger.text; // the real chip phrase — never invented

    const result = await processAgentMessage({
      message: chipText,
      userId: 'sweep-user',
      userToken: undefined, // UC24 is public — no bearer required
      vertical,
      req: { body: { vertical }, tokenEvents: [] },
    });

    expect(result.success).toBe(true);
    expect(result.toolsCalled).toContain('get_branch_hours');
    // Content assertion: the vertical's own first location name must appear.
    // formatBranchCatalogReply now returns a short heading (the AIAgent.js
    // locationCards rendering shows the per-branch detail as cards, not
    // duplicated in the reply text — see publicBranchCatalog.test.js), so the
    // name-level assertion moves to `branches`, the data the cards render from.
    expect(result.branches.map((b) => b.name)).toContain(CATALOG_BY_VERTICAL[vertical][0].name);
    if (vertical !== 'banking') {
      expect(result.reply).not.toContain('Super Banking');
      expect(result.branches.some((b) => b.name.includes('Super Banking'))).toBe(false);
    }
  });
});
