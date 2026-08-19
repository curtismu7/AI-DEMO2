/**
 * Every vertical chip must ROUTE, and every amount-gated chip must actually reach
 * the amount policy.
 *
 * Two silent failure modes this locks down:
 *
 * 1. A vertical missing from VERTICALS gets no perVertical override, so it inherits
 *    BANKING phrases ("transfer $2500 from checking to savings") its own heuristics
 *    cannot route -> kind:'none' -> the agent says "I didn't catch that" and
 *    Authorize + the Gateway are NEVER REACHED. The demo's whole subject silently
 *    does not run, and it reads as a chat glitch rather than a policy gap.
 *    investment (Meridian Wealth) was 6/7 dead exactly this way — and because
 *    VERTICALS is also the list every audit loops over, no test ever looked at it.
 *    The coverage list was its own blind spot.
 *
 * 2. A vertical's amount action missing from WRITE_TOOL_TYPE_MAP routes fine but is
 *    never amount-gated — UC6/7/8 produce no DENY/step-up/consent. That is WORSE
 *    than a dead chip: the demo looks correct while authorizing everything.
 *
 * NOTE for anyone extending this: jest's `expect()` takes ONE argument — the
 * Playwright `expect(value, 'message')` idiom throws "Expect takes at most one
 * argument" and reads like a product failure. Explanatory failures are thrown
 * directly instead.
 */
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { WRITE_TOOL_TYPE_MAP } = require('../services/mcpToolAuthorizationService');

/**
 * A2A handoff/delegation chips are deliberately NOT heuristic-routable (they need an
 * LLM/specialist path), so they are the known baseline — excluded rather than papered
 * over. Everything else must route.
 */
const A2A_UNROUTABLE = /specialist/i;
/**
 * The actual criterion behind that regex: these chips' heuristics live in the
 * A2A overlay, which verticalDispatch merges only for specialist verticals,
 * and this gate parses without the overlay. "specialist" happened to appear in
 * UC2/UC2.5's wording; UC2.6's vertical-neutral trigger does not contain it.
 * Same exemption, keyed on identity instead of phrasing (mirrors
 * A2A_OVERLAY_USE_CASE_IDS in useCases.primaryTool.test.js).
 */
const A2A_OVERLAY_USE_CASE_IDS = new Set([
  'a2a-delegation',
  'a2a-orchestrator-learning',
  'a2a-generalist-mismatch',
]);
const isA2aOverlayChip = (uc, text) =>
  A2A_OVERLAY_USE_CASE_IDS.has(uc.useCaseId) || A2A_UNROUTABLE.test(text);
// UC34/UC35 are free-form LLM analysis chips (primaryTool: null) — the LLM reasons
// freely with no single deterministic heuristic, so they route via the LLM path at
// runtime, not a heuristic match. Excluded like the A2A baseline above (mirrors
// LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js).
const LLM_ANALYSIS_UNROUTABLE = new Set(['UC34', 'UC35']);

/**
 * WRITE_TOOL_TYPE_MAP is keyed by TOOL name. A vertical plugin's heuristic action IS
 * its tool name (pay_fee -> pay_fee), but banking's are not (transfer ->
 * create_transfer). Mirrors toolByAction in demo_api_ui/tests/e2e/helpers/chipPipeline.js.
 */
const BANKING_ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
};
const toolFor = (action) => BANKING_ACTION_TO_TOOL[action] || action;

/** Distinct chip triggers for one vertical, minus the A2A baseline. */
function chipsFor(vertical) {
  const out = [];
  const seen = new Set();
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (isA2aOverlayChip(uc, t.text)) continue;
    if (LLM_ANALYSIS_UNROUTABLE.has(u.id)) continue;
    if (seen.has(t.text)) continue;
    seen.add(t.text);
    out.push({ id: u.id, text: t.text });
  }
  return out;
}

const decisionOf = (r) => ({
  action: r ? (r.banking?.action ?? r.action ?? null) : null,
  params: r ? (r.banking?.params ?? r.params ?? {}) : {},
});

describe('every vertical chip routes (no silent "I didn\'t catch that")', () => {
  test.each(VERTICALS)('%s — all chips resolve to an action', (vertical) => {
    const ctx = resolveVerticalCtx(vertical);
    const dead = chipsFor(vertical)
      .filter((c) => {
        const r = parseHeuristic(c.text, vertical, ctx, {});
        return !r || r.kind === 'none';
      })
      .map((c) => `${c.id} "${c.text}"`);

    if (dead.length) {
      throw new Error(
        `${vertical}: ${dead.length} chip(s) do not route. The agent answers "I didn't catch ` +
          `that" and Authorize/Gateway are NEVER reached — the demo's subject silently does ` +
          `not run.\n  ${dead.join('\n  ')}\n` +
          `Fix: add "${vertical}" to READ_TRIGGER_BY_VERTICAL / amountTriggerByVertical in ` +
          `config/useCases.js with phrases this vertical's own heuristics match.`,
      );
    }
  });
});

describe('every amount-gated chip reaches the amount policy', () => {
  test.each(VERTICALS)('%s — UC6 ($2500 DENY) resolves an AMOUNT-GATED action', (vertical) => {
    const uc = resolveUseCase('UC6', vertical);
    const text = uc && uc.trigger && uc.trigger.text;
    if (!text || A2A_UNROUTABLE.test(text)) return; // vertical has no UC6 chip

    const ctx = resolveVerticalCtx(vertical);
    const { action, params } = decisionOf(parseHeuristic(text, vertical, ctx, {}));

    if (!action) {
      throw new Error(`${vertical}: UC6 chip "${text}" does not route — see the routing test above.`);
    }
    // The stated amount must survive routing — a wrong amount = a wrong decision.
    if (params.amount !== 2500) {
      throw new Error(
        `${vertical}: UC6 chip "${text}" resolved amount=${params.amount}, expected 2500. ` +
          `The DENY policy evaluates this figure.`,
      );
    }
    // …and the tool it dispatches must be one the gate actually evaluates.
    const tool = toolFor(action);
    if (!Object.hasOwn(WRITE_TOOL_TYPE_MAP, tool)) {
      throw new Error(
        `${vertical}: UC6 resolves action "${action}" -> tool "${tool}", which is NOT in ` +
          `WRITE_TOOL_TYPE_MAP — the chip routes but the amount policy NEVER fires (silent ` +
          `authorize: no DENY, no step-up, no consent). That is worse than a dead chip.\n` +
          `Gated tools: ${Object.keys(WRITE_TOOL_TYPE_MAP).join(', ')}`,
      );
    }
  });
});
