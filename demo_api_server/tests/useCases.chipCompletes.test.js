/**
 * Chip COMPLETION gate — routing to the right tool is not the same as working.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * #1288 gave four verticals a real UC28 request-only tool and every gate passed:
 * useCases.primaryTool.test.js proved the chip routes to the stored tool,
 * useCases.scenarioDistinctness.test.js proved the tool is the right KIND, and
 * the step-verification ledger recorded PASS. The chips were still dead. Their
 * tools declared `required: ['id']`, the one-click chip carries no id, and the
 * agent stopped to ask for one:
 *
 *   "To submit filing, I need: Id. Please provide this detail."
 *
 * The tool-boundary story never ran. Nothing could see it, because every other
 * gate stops at the moment BEFORE the tool executes.
 *
 * SCOPE: every catalog chip in every vertical, not just UC28. The bug class is
 * "the tool demands a param the chip's own text does not produce", and nothing
 * about that is specific to UC28 — an earlier draft only checked UC28 and would
 * have missed the identical defect on any other chip.
 *
 * THE INVARIANT IS ABOUT THE HEURISTIC'S OUTPUT, NOT AN EMPTY OBJECT. A first
 * draft asserted `required` must be empty and failed all 16 amount-gated chips
 * (UC6/7/8/22) — wrongly: "pay my $600 bill" DOES carry a param, the heuristic
 * extracts {amount:600}, and pay_bill's required:["amount"] is satisfied. What
 * matters is whether the chip's own text yields everything its tool demands.
 *
 * The two checks answer different questions and BOTH are needed:
 *   - schema:  does the heuristic supply every required field? (catches the
 *              wave-1 bug: required:['id'], chip text yields no id)
 *   - runtime: does the handler actually produce something for those params?
 */
const { VERTICALS, USE_CASES, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');

/**
 * A vertical plugin returns this when the tool is advertised but owned by the MCP
 * executor rather than the plugin (banking does it for request_fee_waiver,
 * get_weather, invest_demo…). Delegation is correct behaviour, NOT a failure — the
 * schema check still applies, only the execution check is skipped.
 */
const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

/** A2A handoff chips need the specialist path, not a plain tool call. */
const A2A_UNROUTABLE = /specialist/i;

// Actions the A2A overlay owns. They are dispatched by the A2A interception with
// real req/vertical context, NOT by the active vertical's plugin — so executing
// one against that plugin is a category error, not a broken chip.
//
// Why this is by tool ownership and not by chip wording: A2A_UNROUTABLE above
// matches on "specialist", which covers UC2/UC2.5 but not UC2.6 ("simulate an
// agent identity mismatch"). UC2.6 passed only because ff_a2a_delegation
// defaulted OFF, so the overlay heuristics were never registered and the chip
// resolved to its primaryTool by accident. With the flag ON it resolves to
// a2a_generalist_mismatch and this harness has nothing to execute it with.
const A2A_OVERLAY_ACTIONS = new Set(
  require('../config/verticals/a2a').getTools().map((t) => t.name),
);

/** Every (vertical, chip) pair the catalog resolves, deduped by trigger text. */
function chipEntries() {
  const out = [];
  for (const vertical of VERTICALS) {
    let plugin;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      plugin = require(`../config/verticals/${vertical}`);
    } catch (_e) {
      continue; // vertical without a plugin is covered by the manifest suites
    }
    const owned = new Map((plugin.getTools() || []).map((t) => [t.name, t]));
    const seen = new Set();
    for (const u of USE_CASES) {
      const uc = resolveUseCase(u.id, vertical) || u;
      const t = uc.trigger || {};
      if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text) || seen.has(t.text)) continue;
      seen.add(t.text);
      if (!uc.primaryTool) continue; // UC34/35 declare none by design
      const def = owned.get(uc.primaryTool);
      if (!def) continue; // api_key feature tools + shared MCP tools live outside the plugin
      // Drive the chip the way the agent does: the ACTION the heuristic picked,
      // with the params it extracted from the chip's own text. Using the
      // primaryTool + {} instead would misjudge both ends — banking's UC7 chip
      // dispatches the scripted `transfer_600_test` alias, not create_transfer
      // directly, and the amount chips carry a real {amount} the text supplies.
      let action = null;
      let params = {};
      try {
        const r = parseHeuristic(t.text, vertical, resolveVerticalCtx(vertical), {});
        action = r ? (r.banking?.action ?? r.action ?? null) : null;
        params = (r && (r.banking?.params ?? r.params)) || {};
      } catch (_e) {
        /* routing itself is gated by useCases.primaryTool.test.js */
      }
      if (action && A2A_OVERLAY_ACTIONS.has(action)) continue;
      out.push({ vertical, id: u.id, text: t.text, tool: uc.primaryTool, def, plugin, action, params });
    }
  }
  return out;
}

const ENTRIES = chipEntries();
const label = (e) => `${e.vertical} ${e.id} ${e.tool}`;

describe('every required param is supplied by the chip text itself', () => {
  // The wave-1 bug, checked for EVERY chip: required:['id'] while the chip text
  // yields no id, so the agent stops to ask and the scenario never runs. Amount
  // chips pass — "pay my $600 bill" yields {amount:600} for required:['amount'].
  test.each(ENTRIES.map((e) => [label(e), e]))('%s', (_name, e) => {
    const required = (e.def.inputSchema && e.def.inputSchema.required) || [];
    const missing = required.filter((k) => e.params[k] === undefined);
    if (missing.length) {
      throw new Error(
        `${e.vertical}/${e.id}: chip "${e.text}" dispatches "${e.tool}", which requires ` +
          `${JSON.stringify(required)}, but the heuristic extracts only ` +
          `${JSON.stringify(Object.keys(e.params))} — missing ${JSON.stringify(missing)}. ` +
          `The agent answers "To ${e.tool.replace(/_/g, ' ')}, I need: …" and the scenario ` +
          `never runs. Either make the field optional and default it in the handler (see ` +
          `sporting-goods request_price_match, or healthcare's WRITE_TOOLS defaultFrom), or ` +
          `reword the chip so the text carries the value.`,
      );
    }
  });
});

describe('every chip the plugin OWNS completes with the params its text yields', () => {
  test.each(ENTRIES.map((e) => [label(e), e]))('%s', async (_name, e) => {
    let out;
    try {
      out = await e.plugin.executeTool(e.action || e.tool, e.params, { userId: '1' });
    } catch (err) {
      throw new Error(
        `${e.vertical}/${e.id}: "${e.action || e.tool}" THREW on the chip's own params ` +
          `${JSON.stringify(e.params)}: ${err.message}`,
      );
    }
    // Delegated to the MCP executor — legitimate, and the schema check above
    // already covered it.
    if (out === NOT_MY_TOOL || out === null || out === undefined) return;

    const result = (out && out.result) || {};
    if (result.error) {
      throw new Error(
        `${e.vertical}/${e.id}: chip "${e.text}" -> "${e.action || e.tool}" returned ` +
          `{ error: ${JSON.stringify(result.error)} } for the params its own text yields ` +
          `(${JSON.stringify(e.params)}). The chip cannot complete, so the scenario demos ` +
          `nothing while routing gates stay green. Default the record in the handler instead ` +
          `of erroring.`,
      );
    }
    // Deliberately NOT asserting the payload is non-empty. banking's money actions
    // go through dispatchBankingAction, which needs a real user token and MCP
    // context this unit test has no business minting — they return an empty result
    // here and that is the harness's limit, not a defect. An explicit
    // `result.error` is the signal that survives without a live stack.
  });
});

describe('the gate covers what it claims to', () => {
  // Not a magic count: assert COVERAGE per vertical, so a vertical silently
  // dropping out of the catalog (or its plugin failing to load) is visible. The
  // previous version asserted `subjects.length >= 8` against an actual of 8 —
  // true by construction, and it excluded banking outright.
  const covered = new Set(ENTRIES.map((e) => e.vertical));

  test('every vertical with a plugin contributes at least one checked chip', () => {
    const missing = [];
    for (const v of VERTICALS) {
      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        require(`../config/verticals/${v}`);
      } catch (_e) {
        continue;
      }
      if (!covered.has(v)) missing.push(v);
    }
    if (missing.length) {
      throw new Error(
        `${missing.join(', ')}: no chip is completion-checked. Either the vertical's chips all ` +
          `resolve to tools outside its plugin, or it fell out of the catalog — both hide the ` +
          `"chip cannot complete" class of bug for that vertical.`,
      );
    }
  });

  test('banking is covered — it was excluded before, and it is where UC28 first broke', () => {
    // banking/UC28's golden held "I don't recognize that action (request_fee_waiver)"
    // for a week. Excluding the vertical that already broke is how a gate lies.
    expect(covered.has('banking')).toBe(true);
  });
});
