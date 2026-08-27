'use strict';

/**
 * @file intentTokenService.showcaseChips.test.js
 * @description The two chip-driven showcase tools must be reachable by their intent.
 *
 * server.js's _TOOL_TO_INTENT has no entry for these, so the minted intent falls
 * back to the TOOL NAME at confidence 0.50. With no INTENT_TO_PERMITTED_TOOLS
 * entry, permittedToolsForIntent fell through to the vertical's read-only list —
 * which excludes them — and the gateway denied every call:
 *
 *   intent_mismatch: tool "get_weather" not permitted for intent "get_weather"
 *
 * Demo impact, measured live 2026-08-26: UC30 ("what's the weather in Austin, TX",
 * which should PERMIT — Austin is in Texas) and UC31 ("...in Miami", which the
 * Texas geofence should deny) BOTH failed here. So UC31 looked correct while
 * denying for the wrong reason, and no test asserting only DENY could tell.
 *
 * This became reachable only after scope-topology registration (PR #2436) got
 * these tools past decision.js Rule 3's unknown_tool deny.
 */

const {
  permittedToolsForIntent,
  INTENT_TO_PERMITTED_TOOLS,
} = require('../../services/intentTokenService');

describe('showcase chip intents', () => {
  // The intent label IS the tool name here — that is the fallback server.js uses.
  it.each([
    ['get_weather', 'banking'],
    ['get_weather', 'sporting-goods'],
    ['get_branch_hours', 'banking'],
    ['get_branch_hours', 'healthcare'],
  ])('intent %s in %s permits its own tool', (intent, vertical) => {
    expect(permittedToolsForIntent(intent, vertical)).toContain(intent);
  });

  // Least privilege: a 0.50-confidence fallback intent must not widen anything.
  it.each(['get_weather', 'get_branch_hours'])('%s grants EXACTLY one tool', (intent) => {
    expect(INTENT_TO_PERMITTED_TOOLS[intent]).toEqual([intent]);
  });

  it('does not let a showcase intent reach a sensitive or write tool', () => {
    for (const intent of ['get_weather', 'get_branch_hours']) {
      const permitted = permittedToolsForIntent(intent, 'banking');
      expect(permitted.some((t) => /^(create_|update_|delete_|sensitive|get_sensitive)/.test(t))).toBe(false);
    }
  });

  // Guard the mechanism, not just the two entries: if the fallback ever starts
  // including these, the entries above stop being what makes the chips work and
  // this test stops meaning anything.
  it('the unknown-intent fallback still does NOT include them', () => {
    const fallback = permittedToolsForIntent('some_unclassified_intent', 'banking');
    expect(fallback).not.toContain('get_weather');
    expect(fallback).not.toContain('get_branch_hours');
  });

  it('leaves existing mappings untouched', () => {
    expect(permittedToolsForIntent('view_balance', 'banking'))
      .toEqual(['get_account_balance', 'get_my_accounts']);
  });
});
