// demo_api_server/tests/intentToken.writeIntentBinding.regression.test.js
//
// Regression: nlIntentParser's extractIntentAndConfidence recognizes UC6-style
// write intents (pay_bill, pay_tuition_balance, large_trade,
// approve_purchase_order, ...), but INTENT_TO_PERMITTED_TOOLS in
// intentTokenService lacked entries for four of them. The minted Intent Token
// then fell back to the vertical's READ-ONLY list, and PingGateway P1AZ denied
// the write with intent_mismatch ("Tool X is not in the validated intent
// token's permitted_tools") instead of the amount-band HITL/step-up the demo
// proves. Live symptom 2026-08-04: "approve a $300 purchase order" in
// manufacturing showed "declined by the gateway's authorization policy",
// ProofStrip "HITL consent — Mismatch".
//
// Class guard: every write intent the extractor can emit must carry ITS OWN
// tool in permittedToolsForIntent — an extractor branch added without a
// token-service entry fails here instead of at demo time.

const { extractIntentAndConfidence } = require('../services/nlIntentParser');
const { permittedToolsForIntent } = require('../services/intentTokenService');

// Prompt → the vertical whose chip sends it. Phrasings mirror the UC6 chips /
// the live prompts that regressed.
const WRITE_PROMPTS = [
  ['approve a $300 purchase order', 'manufacturing'],
  ['pay my utility bill', 'healthcare'],
  ['pay tuition for this term', 'university'],
  ['execute a large trade', 'investment'],
  ['pay my permit fees', 'government'],
  ['extend my rental', 'sporting-goods'],
  ['submit expenses for approval', 'workforce'],
  ['checkout my cart', 'retail'],
];

describe('intent token — write intents carry their own tool (regression)', () => {
  test.each(WRITE_PROMPTS)('"%s" (%s)', (prompt, vertical) => {
    const { intent, toolName, confidence } = extractIntentAndConfidence(prompt);
    expect(intent).not.toBe('unknown');
    expect(confidence).toBeGreaterThanOrEqual(0.9);
    const permitted = permittedToolsForIntent(intent, vertical);
    expect(permitted).toContain(toolName);
  });

  test('unknown intent still falls back to the vertical read-only list (no write unlock)', () => {
    const permitted = permittedToolsForIntent('unknown', 'manufacturing');
    expect(permitted).not.toContain('approve_purchase_order');
    expect(permitted).toContain('view_purchase_orders');
  });
});
