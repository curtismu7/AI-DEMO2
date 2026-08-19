'use strict';

/**
 * Regression: the airlines chips were denied at the gateway with
 * `gateway_policy_denied / access_denied` because `READ_ONLY_TOOLS_BY_VERTICAL`
 * had no `airlines` key. permittedToolsForIntent() then fell back to the BANKING
 * read list, so the minted Intent Token's `permitted_tools` never contained
 * get_airline_bookings — and the gateway rejects any tool outside that claim.
 *
 * The failure is easy to misread: the vertical, the scope and the P1AZ decision
 * were all correct (PERMIT), and the token still bound the wrong tool set.
 */

const { mintIntentToken, INTENT_TO_PERMITTED_TOOLS } = require('../services/intentTokenService');

const AIRLINES_TOOLS = ['get_airline_bookings', 'get_flight_status', 'check_seat_availability'];

function claimsFor({ intent, vertical }) {
  const { token } = mintIntentToken({
    userId: 'u1', sessionId: 's1', prompt: 'show my reservations', intent, confidence: 0.5, vertical,
  });
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('intent token — airlines', () => {
  test.each(AIRLINES_TOOLS)('intent "%s" permits itself', (tool) => {
    expect(claimsFor({ intent: tool, vertical: 'airlines' }).permitted_tools).toContain(tool);
  });

  test.each(AIRLINES_TOOLS)('an unclassified airlines prompt still permits %s', (tool) => {
    // The chip path mints with intent === the tool name, but an LLM-routed or
    // unrecognized prompt falls through to the per-vertical read list. Both
    // routes must reach the same tools or the chip works and chat does not.
    expect(claimsFor({ intent: 'something_unrecognized', vertical: 'airlines' }).permitted_tools).toContain(tool);
  });

  test('airlines no longer falls back to the banking read list', () => {
    const permitted = claimsFor({ intent: 'something_unrecognized', vertical: 'airlines' }).permitted_tools;
    expect(permitted).not.toContain('get_my_accounts');
    expect(permitted).not.toContain('get_portfolio_summary');
  });

  test('the airlines intents are declared, not inherited from the prototype', () => {
    for (const tool of AIRLINES_TOOLS) {
      expect(Object.hasOwn(INTENT_TO_PERMITTED_TOOLS, tool)).toBe(true);
    }
  });

  test('banking is unaffected', () => {
    const permitted = claimsFor({ intent: 'view_balance', vertical: 'banking' }).permitted_tools;
    expect(permitted).toEqual(expect.arrayContaining(['get_account_balance', 'get_my_accounts']));
  });
});
