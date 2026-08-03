/**
 * Chip COMPLETION gate — routing to the right tool is not the same as working.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * Wave 1 gave four verticals a real UC28 request-only tool and every gate passed:
 * useCases.primaryTool.test.js proved the chip routes to the stored tool,
 * useCases.scenarioDistinctness.test.js proved the tool is the right KIND, and
 * the step-verification ledger recorded PASS. The chips were still dead. Their
 * tools declared `required: ['id']`, the one-click chip carries no id, and the
 * agent stopped to ask for one:
 *
 *   "To submit filing, I need: Id. Please provide this detail."
 *
 * The Air Canada boundary was never demonstrated. Nothing could see it, because
 * every existing gate stops at the moment BEFORE the tool runs.
 *
 * This gate executes the tool the way the chip does — no params — and fails if it
 * comes back an error. It is deliberately narrow: it does NOT assert on the shape
 * of the payload (that is the vertical's business), only that a one-click chip
 * produces a result rather than a dead end.
 */
const {
  VERTICALS,
  resolveUseCase,
  REQUEST_ONLY_TOOL_BY_VERTICAL,
  REQUEST_ONLY_NOT_APPLICABLE,
} = require('../config/useCases.js');

/** Verticals whose UC28 chip drives a real request-only tool. */
const UC28_VERTICALS = VERTICALS.filter(
  (v) => v === 'banking' || (v in REQUEST_ONLY_TOOL_BY_VERTICAL),
);

/**
 * banking's request_fee_waiver is dispatched by AIAgent.js (it resolves an
 * account first, then calls the MCP tool with account_id), not by the vertical
 * plugin — there is no plugin executeTool to drive here. Its completion is
 * covered by the UI path, so exclude it rather than assert something false.
 */
const CLIENT_DISPATCHED_UC28 = new Set(['banking']);

describe('UC28 request-only chips COMPLETE, not just route', () => {
  const subjects = UC28_VERTICALS.filter((v) => !CLIENT_DISPATCHED_UC28.has(v));

  test('the gate actually covers something (guard against silent scoping-away)', () => {
    expect(subjects.length).toBeGreaterThanOrEqual(8);
  });

  test.each(subjects)('%s — UC28 tool returns a result with NO params', async (vertical) => {
    const uc = resolveUseCase('UC28', vertical);
    const tool = uc.primaryTool;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const plugin = require(`../config/verticals/${vertical}`);
    const out = await plugin.executeTool(tool, {}, { userId: '1' });
    const result = (out && out.result) || {};

    if (result.error) {
      throw new Error(
        `${vertical}: UC28 tool "${tool}" returned { error: ${JSON.stringify(result.error)} } ` +
          `when called with no params — the one-click chip cannot complete. Default the id to ` +
          `the member's first record (see sporting-goods request_price_match) and drop it from ` +
          `the tool's inputSchema.required.`,
      );
    }
    expect(out).toBeTruthy();
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  test.each(subjects)('%s — UC28 tool does not REQUIRE a param the chip cannot supply', (vertical) => {
    const uc = resolveUseCase('UC28', vertical);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const plugin = require(`../config/verticals/${vertical}`);
    const def = plugin.getTools().find((t) => t.name === uc.primaryTool);
    expect(def).toBeTruthy();
    const required = (def.inputSchema && def.inputSchema.required) || [];
    if (required.length) {
      throw new Error(
        `${vertical}: UC28 tool "${uc.primaryTool}" declares required: ${JSON.stringify(required)}. ` +
          `The chip carries no params, so the agent stops to ask for them and the tool-boundary ` +
          `story never runs. Make them optional and default in the handler.`,
      );
    }
  });

  test('every vertical is accounted for — mapped, N/A, or client-dispatched', () => {
    const unaccounted = VERTICALS.filter(
      (v) =>
        !(v in REQUEST_ONLY_TOOL_BY_VERTICAL) &&
        !(v in REQUEST_ONLY_NOT_APPLICABLE) &&
        !CLIENT_DISPATCHED_UC28.has(v),
    );
    expect(unaccounted).toEqual([]);
  });
});
