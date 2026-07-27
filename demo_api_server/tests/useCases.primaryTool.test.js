/**
 * primaryTool drift gates — per-vertical prompt/response contract.
 *
 * Every vertical stores its OWN primaryTool (even where values duplicate a
 * neighbour's) — isolation over DRY, so changing or removing one vertical's
 * entry cannot silently change what another vertical's chip demos. These gates
 * hold each vertical to its own stored truth:
 *
 * 1. EXISTENCE: every resolved (vertical, useCase) primaryTool must exist in a
 *    real tool surface. Catches renames/removals and dangling premises.
 * 2. ROUTING (ALL verticals): every chip must ROUTE to its own vertical's
 *    stored primaryTool. Catches the wrong-tool class — e.g. a planned entry
 *    ("Can you waive the fee on my checking account?", primaryTool
 *    request_fee_waiver) actually routes to `accounts`: the chip would list
 *    accounts while the tool-boundary story silently never runs, and every
 *    pipeline check would stay green.
 *
 * History: this gate was originally scoped to banking because primaryTool was
 * banking-base metadata shared by all verticals (68/72 vertical entries "lied"
 * about their own tool). Per-vertical storage removed that limitation. If a
 * value in READ_PRIMARY_TOOL_BY_VERTICAL / AMOUNT_PRIMARY_TOOL_BY_VERTICAL is
 * wrong, the routing gate fails naming the vertical, chip, and both tools.
 */
const fs = require('fs');
const path = require('path');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Not MCP tools: orchestration actions handled by the A2A layer, not a registry. */
const NON_MCP_PRIMARY_TOOLS = new Set(['delegate_to_specialist']);
/** A2A handoff chips are intentionally not heuristic-routable — the known baseline. */
const A2A_UNROUTABLE = /specialist/i;
/** UC34/UC35 are free-form LLM analysis chips with no single deterministic tool — the
 *  only other sanctioned exception besides A2A "specialist" handoffs. */
const LLM_ANALYSIS_UNROUTABLE = new Set(['UC34', 'UC35']);

/**
 * Heuristic ACTION -> dispatched TOOL where they differ. Vertical plugin actions
 * ARE their tool names (identity fallback). transfer_600_test is a scripted
 * showcase alias: its AIAgent case POSTs /api/transactions with
 * DEMO_HITL_TRANSFER (600) and the HITL gate fires — it IS create_transfer.
 */
const { ACTION_TO_TOOL } = require('./helpers/actionToTool');

/** Every (vertical, useCase) chip entry with a real resolved primaryTool. */
function chipEntries() {
  const out = [];
  for (const vertical of VERTICALS) {
    for (const u of USE_CASES) {
      const uc = resolveUseCase(u.id, vertical) || u;
      const t = uc.trigger || {};
      if (t.type !== 'chip' || !t.text) continue;
      if (A2A_UNROUTABLE.test(t.text) || LLM_ANALYSIS_UNROUTABLE.has(u.id)) continue;
      if (!uc.primaryTool || NON_MCP_PRIMARY_TOOLS.has(uc.primaryTool)) continue;
      out.push({ vertical, id: u.id, text: t.text, primaryTool: uc.primaryTool });
    }
  }
  return out;
}

describe('primaryTool existence — no dangling tool premises, any vertical', () => {
  test('every resolved primaryTool exists in a tool registry', () => {
    const surfaces = [
      read('demo_mcp_server/src/tools/BankingToolRegistry.ts'),
      read('demo_mcp_server/src/tools/handlers/verticalTools.generated.ts'),
      // weather-mcp showcase: a real MCP tool, but hosted by a third-party MCP
      // server (not demo_mcp_server) — registered here instead.
      read('demo_api_server/utils/mcpToolRegistry.js'),
    ];
    const missing = [];
    for (const tool of new Set(chipEntries().map((e) => e.primaryTool))) {
      const exists = surfaces.some(
        (s) => s.includes(`'${tool}'`) || s.includes(`"${tool}"`) || s.includes(`${tool}:`),
      );
      if (!exists) missing.push(tool);
    }
    if (missing.length) {
      throw new Error(
        `primaryTool(s) stored in useCases.js but found in NO tool registry: ${missing.join(', ')}. ` +
          `A use case whose tool does not exist demos nothing — its premise is dangling. Fix the ` +
          `tool name, or if it is a new non-MCP orchestration action, add it to ` +
          `NON_MCP_PRIMARY_TOOLS here WITH a justification.`,
      );
    }
  });
});

describe('chip dollar amounts are canonical threshold tiers', () => {
  // Policy: no hardcoded amounts unless the amount IS the demo. The three tiers
  // demonstrate the three policy outcomes ($300 consent, $600 step-up, $2500
  // DENY) and map to the thresholds the gates actually evaluate. An arbitrary
  // amount ("Transfer $1000", "$750") demos nothing the tiers don't, drifts
  // independently, and confuses which policy boundary is being shown — the old
  // AiAttacksPanel free-text "$1000" prompt was exactly this.
  const CANONICAL_AMOUNTS = new Set([300, 600, 2500]);
  // Add an entry here ONLY when a use case's whole point is a non-tier amount,
  // with the reason: e.g. { 3000: 'UC99 demos the daily cumulative cap' }.
  const AMOUNT_EXCEPTIONS = {
    150: 'UC22 CIBA demos the trigger is agent-context + action sensitivity, not amount — deliberately below the $300 tier',
  };

  test('every $ amount in a chip trigger is a canonical tier or a justified exception', () => {
    const offenders = [];
    for (const vertical of VERTICALS) {
      for (const u of USE_CASES) {
        const uc = resolveUseCase(u.id, vertical) || u;
        const t = uc.trigger || {};
        if (t.type !== 'chip' || !t.text) continue;
        const m = t.text.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/);
        if (!m) continue;
        const n = Number(m[1].replace(/,/g, ''));
        if (!CANONICAL_AMOUNTS.has(n) && !(n in AMOUNT_EXCEPTIONS)) {
          offenders.push(`${vertical}/${u.id} "${t.text}" uses $${n}`);
        }
      }
    }
    if (offenders.length) {
      throw new Error(
        `Non-canonical dollar amount(s) in chip triggers:\n  ${offenders.join('\n  ')}\n` +
          `Use a canonical tier ($300 consent / $600 step-up / $2500 DENY) via ` +
          `amountTriggerByVertical(n), or add a justified entry to AMOUNT_EXCEPTIONS.`,
      );
    }
  });
});

describe('every vertical chip routes to its OWN stored primaryTool', () => {
  const entries = chipEntries();

  test('every chip DECLARES a primaryTool — none may escape the contract', () => {
    // chipEntries() filters on `uc.primaryTool`, so a chip ADDED without one
    // would silently skip the routing gate — exactly the drift this suite
    // exists to prevent. 7 banking base entries escaped this way until
    // 2026-07-17. A2A "specialist" chips are the only sanctioned exception.
    const naked = [];
    for (const vertical of VERTICALS) {
      for (const u of USE_CASES) {
        const uc = resolveUseCase(u.id, vertical) || u;
        const t = uc.trigger || {};
        if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text) || LLM_ANALYSIS_UNROUTABLE.has(u.id)) continue;
        if (!uc.primaryTool) naked.push(`${vertical} ${u.id} "${t.text}"`);
      }
    }
    if (naked.length) {
      throw new Error(
        `${naked.length} chip(s) declare NO primaryTool and therefore silently skip the routing ` +
          `contract:\n  ${naked.join('\n  ')}\nAdd the tool to the entry (banking: base entry; ` +
          `other verticals: READ_/AMOUNT_PRIMARY_TOOL_BY_VERTICAL in useCases.js).`,
      );
    }
  });

  test('the gate covers every vertical (guard against silent scoping-away)', () => {
    const covered = new Set(entries.map((e) => e.vertical));
    for (const v of VERTICALS) {
      if (!covered.has(v)) {
        throw new Error(
          `${v}: no chip entry carries a primaryTool — the vertical has fallen out of the ` +
            `per-vertical prompt/response contract (check READ_PRIMARY_TOOL_BY_VERTICAL / ` +
            `AMOUNT_PRIMARY_TOOL_BY_VERTICAL in useCases.js).`,
        );
      }
    }
  });

  test.each(entries.map((e) => [e.vertical, e.id, e.text, e.primaryTool]))(
    '%s %s "%s" -> %s',
    (vertical, id, text, primaryTool) => {
      const ctx = resolveVerticalCtx(vertical);
      const r = parseHeuristic(text, vertical, ctx, {});
      const action = r ? (r.banking?.action ?? r.action ?? null) : null;
      const tool = ACTION_TO_TOOL[action] || action;
      if (tool !== primaryTool) {
        throw new Error(
          `${vertical}/${id}: chip "${text}" routes to action "${action}" -> tool "${tool}", but this ` +
            `vertical's stored primaryTool is "${primaryTool}". The chip demos the WRONG thing while ` +
            `every pipeline check stays green. Either the trigger phrase collides with another ` +
            `heuristic (reword it), no heuristic exists for the tool (add one), or the stored ` +
            `per-vertical primaryTool is wrong (fix it in useCases.js).`,
        );
      }
    },
  );
});
