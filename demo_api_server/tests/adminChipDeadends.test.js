'use strict';

/**
 * Regression — the admin "View Profile" and pingone-admin "List Users" chips
 * must resolve to their action (not dead-end to the capability catalog). The
 * regexes previously rejected filler words ("show FULL profile", "list THE
 * users"), so in default heuristic mode the chip returned kind:none.
 */

const { parseHeuristic } = require('../services/nlIntentParser');

const actionOf = (r) => (r && (r.action || r.kind)) || 'none';

describe('admin / pingone-admin chip messages resolve (no dead-end)', () => {
  test('admin "View Profile" chip message resolves to get_customer_profile', () => {
    const r = parseHeuristic('show full profile for this customer', 'banking', { isAdmin: true });
    expect(actionOf(r)).toBe('get_customer_profile');
  });

  test('admin profile regex does not over-match unrelated admin phrases', () => {
    const r = parseHeuristic('show me the recent transactions', 'banking', { isAdmin: true });
    expect(actionOf(r)).not.toBe('get_customer_profile');
  });

  test('pingone-admin "List Users" chip message resolves to call_pingone_tool', () => {
    const r = parseHeuristic('List the users in my PingOne environment', 'pingone-admin', {});
    expect(actionOf(r)).toBe('call_pingone_tool');
  });

  test('pingone-admin still resolves "List the applications"', () => {
    const r = parseHeuristic('List the applications', 'pingone-admin', {});
    expect(actionOf(r)).toBe('call_pingone_tool');
  });
});
