/**
 * primaryTool drift gates.
 *
 * A use case whose `primaryTool` names a tool that doesn't exist — or whose chip
 * routes somewhere else entirely — demos the WRONG thing while every pipeline
 * check stays green. Near-miss that motivated this: a planned catalog entry
 * ("Can you waive the fee on my checking account?", primaryTool
 * request_fee_waiver) actually routes to `accounts` — the chip would list
 * accounts and the tool-boundary story would silently never run.
 *
 * Two gates, scoped to what the catalog's own semantics support:
 *
 * 1. EXISTENCE (all entries): every distinct primaryTool must exist in a real
 *    tool surface. Catches renames/removals and dangling premises.
 * 2. ROUTING (banking write-chips only): a banking chip whose primaryTool is an
 *    amount-gated write tool must ROUTE to that tool. Scoped to banking because
 *    vertical overlays legitimately dispatch their own tools (healthcare UC6's
 *    chip runs pay_bill while base primaryTool says create_transfer) — auditing
 *    all verticals produced 68/72 "mismatches" that are overlay semantics, not
 *    bugs. Banking has no overlay, so there a mismatch IS a bug.
 */
const fs = require('fs');
const path = require('path');
const { USE_CASES, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { WRITE_TOOL_TYPE_MAP } = require('../services/mcpToolAuthorizationService');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Not MCP tools: orchestration actions handled by the A2A layer, not a registry. */
const NON_MCP_PRIMARY_TOOLS = new Set(['delegate_to_specialist']);

/**
 * Banking heuristic ACTION -> dispatched TOOL. transfer_600_test is a scripted
 * showcase alias: its AIAgent case calls createTransfer(DEMO_LARGE_TRANSFER) and
 * the HITL gate fires in normalizeAgentToolResult — i.e. it IS create_transfer.
 */
const BANKING_ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  branch_hours: 'get_branch_hours',
};

describe('primaryTool existence — no dangling tool premises', () => {
  test('every catalog primaryTool exists in a tool registry', () => {
    const bankingRegistry = read('demo_mcp_server/src/tools/BankingToolRegistry.ts');
    const verticalRegistry = read('demo_mcp_server/src/tools/handlers/verticalTools.generated.ts');
    const missing = [];
    for (const tool of new Set(USE_CASES.map((u) => u.primaryTool).filter(Boolean))) {
      if (NON_MCP_PRIMARY_TOOLS.has(tool)) continue;
      const exists =
        bankingRegistry.includes(`'${tool}'`) ||
        bankingRegistry.includes(`${tool}:`) ||
        verticalRegistry.includes(`"${tool}"`);
      if (!exists) missing.push(tool);
    }
    if (missing.length) {
      throw new Error(
        `primaryTool(s) named in useCases.js but found in NO tool registry: ${missing.join(', ')}. ` +
          `A use case whose tool does not exist demos nothing — its whole premise is dangling. ` +
          `Fix the tool name, or if it is a new non-MCP orchestration action, add it to ` +
          `NON_MCP_PRIMARY_TOOLS here WITH a justification.`,
      );
    }
  });
});

describe('banking chips route to their primaryTool', () => {
  const ctx = resolveVerticalCtx('banking');
  // ALL banking chips with a real (non-A2A) primaryTool — not just amount-gated
  // writes. Scoping to WRITE_TOOL_TYPE_MAP would have missed the motivating
  // near-miss: request_fee_waiver is a write but not amount-gated, and its
  // planned chip routed to `accounts`.
  const entries = USE_CASES.filter((u) => {
    const uc = resolveUseCase(u.id, 'banking') || u;
    const t = uc.trigger || {};
    return t.type === 'chip' && t.text && u.primaryTool && !NON_MCP_PRIMARY_TOOLS.has(u.primaryTool);
  });

  test('there are banking chips to gate (guard against silent scoping-away)', () => {
    expect(entries.length).toBeGreaterThan(0);
    // WRITE_TOOL_TYPE_MAP is imported to keep the amount-gating contract visible
    // to readers of this gate; the coverage suite asserts it per-vertical.
    expect(Object.keys(WRITE_TOOL_TYPE_MAP).length).toBeGreaterThan(0);
  });

  test.each(entries.map((u) => [u.id, (resolveUseCase(u.id, 'banking') || u).trigger.text, u.primaryTool]))(
    '%s "%s" routes to %s',
    (id, text, primaryTool) => {
      const r = parseHeuristic(text, 'banking', ctx, {});
      const action = r ? (r.banking?.action ?? r.action ?? null) : null;
      const tool = BANKING_ACTION_TO_TOOL[action] || action;
      if (tool !== primaryTool) {
        throw new Error(
          `${id}: chip "${text}" routes to action "${action}" -> tool "${tool}", but primaryTool is ` +
            `"${primaryTool}". The chip demos the WRONG thing while every pipeline check stays green. ` +
            `Either the trigger phrase collides with another heuristic (reword it), no heuristic exists ` +
            `for the tool (add one), or primaryTool is wrong (fix the metadata).`,
        );
      }
    },
  );
});
