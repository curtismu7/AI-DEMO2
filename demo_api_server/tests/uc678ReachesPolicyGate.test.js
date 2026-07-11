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
  test('banking transfer chip parses with source + destination + amount', () => {
    const r = parseHeuristic('transfer $600 from checking to savings', 'banking', {});
    const p = r.banking ? r.banking : r;
    expect(p.action).toBe('transfer');
    expect(p.params.fromId).toBeTruthy();
    expect(p.params.toId).toBeTruthy();
    expect(Number(p.params.amount)).toBe(600);
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
