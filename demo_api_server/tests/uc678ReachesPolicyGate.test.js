'use strict';

/**
 * Regression — the UC6/7/8 amount-driven policy chips must PARSE into a write
 * action whose required params are all satisfied, so they reach the PingOne
 * Authorize amount gate (DENY/step-up/HITL) instead of stalling on a
 * "please provide source account / bill id" clarify prompt.
 *
 * Guards the fix: banking chip text now carries "from checking"; the four
 * verticals' write tools require only `amount` (id defaulted in the handler).
 */

const { parseHeuristic } = require('../services/nlIntentParser');
const { verticalManifest } = require('../services/verticalManifest');

function requiredFor(vertical, action) {
  const pl = verticalManifest.plugins.get(vertical);
  const t = (pl.getTools() || []).find((x) => x.name === action);
  return (t && t.inputSchema && t.inputSchema.required) || [];
}

describe('UC6/7/8 amount chips reach the Authorize gate (no clarify stall)', () => {
  // UC6 ($2500 → DENY) and UC8 ($300 → HITL) hit the generic transfer rule, which
  // extracts every required param up front.
  test.each([
    ['transfer $2500 from checking to savings', 2500],
    ['transfer $300 from checking to savings', 300],
  ])('banking transfer chip %s parses with source + destination + amount', (msg, amount) => {
    const r = parseHeuristic(msg, 'banking', {});
    const p = r.banking ? r.banking : r;
    expect(p.action).toBe('transfer');
    expect(p.params.fromId).toBeTruthy();
    expect(p.params.toId).toBeTruthy();
    expect(Number(p.params.amount)).toBe(amount);
  });

  // UC7's $600 chip is special-cased to the demo action `transfer_600_test`
  // (config/verticals/banking/index.js — the rule deliberately precedes the
  // generic transfer for specificity, and the chip UI has a dedicated handler).
  // It carries no params; demoAgentLangGraphService normalizes it back to a real
  // transfer (checking → savings, 600) before any clarify check, so the chip
  // still reaches the Authorize step-up gate without stalling.
  test('UC7 $600 chip maps to the transfer_600_test demo action', () => {
    const r = parseHeuristic('transfer $600 from checking to savings', 'banking', {});
    const p = r.banking ? r.banking : r;
    expect(r.kind).toBe('banking');
    expect(p.action).toBe('transfer_600_test');
  });

  const verticalChips = [
    ['healthcare', 'pay my $300 bill', 'pay_bill'],
    ['university', 'pay $300 tuition', 'pay_tuition_balance'],
    ['manufacturing', 'approve a $300 purchase order', 'approve_purchase_order'],
    ['workforce', 'submit a $300 expense', 'submit_expense'],
  ];

  test.each(verticalChips)('%s write chip has no missing required params', (vertical, msg, action) => {
    const r = parseHeuristic(msg, vertical, {});
    const params = r.params || (r.banking && r.banking.params) || {};
    expect(r.action || (r.banking && r.banking.action)).toBe(action);
    expect(Number(params.amount)).toBe(300);
    const required = requiredFor(vertical, action);
    const missing = required.filter((k) => params == null || params[k] == null || params[k] === '');
    expect(missing).toEqual([]);
  });
});
