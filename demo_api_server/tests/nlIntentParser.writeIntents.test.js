'use strict';
// UC6 over-limit demo, every vertical: the intent token must carry the
// vertical's WRITE tool for its "$2500" chip phrase, or PingGateway P1AZ
// denies on mcp-intent-mismatch instead of the amount rule the demo stars.
// Live incident 2026-08-04: government "pay the $2500 fee" minted an intent
// token for view_fees, so the DENY reason was intent_mismatch, not amount.
const { extractIntentAndConfidence } = require('../services/nlIntentParser');

describe('extractIntentAndConfidence — per-vertical write intents (UC6 chips)', () => {
  const WRITE_CASES = [
    ['pay the $2500 fee', 'pay_fee'],                 // government
    ['pay my $2500 bill', 'pay_bill'],                // healthcare
    ['execute a large trade of $2500', 'large_trade'],// investment
    ['approve a $2500 purchase order', 'approve_purchase_order'], // manufacturing
    ['extend my rental $2500', 'extend_rental'],      // sporting-goods
    ['pay $2500 tuition', 'pay_tuition_balance'],     // university
    ['submit a $2500 expense', 'submit_expense'],     // workforce
  ];

  test.each(WRITE_CASES)('"%s" resolves the write tool %s with high confidence', (msg, tool) => {
    const r = extractIntentAndConfidence(msg);
    expect(r.toolName).toBe(tool);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  // The read intents these phrases previously collapsed into must still work —
  // gv2/inv3 chips and the #1296 READ_ONLY_INTENTS allowlist depend on them.
  const READ_CASES = [
    ['what fees do I owe', 'view_fees'],
    ['show my trades', 'view_trades'],
    ['show my holdings', 'view_holdings'],
  ];

  test.each(READ_CASES)('"%s" still resolves the read intent %s', (msg, tool) => {
    const r = extractIntentAndConfidence(msg);
    expect(r.toolName).toBe(tool);
  });

  // Banking's existing high-confidence writes are untouched.
  test('banking transfer keeps create_transfer @0.95', () => {
    const r = extractIntentAndConfidence('transfer $2500 from checking to savings');
    expect(r).toMatchObject({ toolName: 'create_transfer', confidence: 0.95 });
  });
});
