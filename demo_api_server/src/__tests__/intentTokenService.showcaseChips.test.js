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

/**
 * The other half of the chain, and the half that was still broken after the
 * mapping above shipped: /api/agent/invoke and /api/agent/run both mint the
 * Intent Token from extractIntentAndConfidence(prompt) — NOT from the tool name.
 * That classifier had no weather or branch-hours branch, so the chip prompts
 * classified as "unknown" @0.3, permitted_tools fell back to the vertical reads,
 * and PingGateway denied with (measured live 2026-08-31):
 *
 *   intent_mismatch: tool "get_weather" not permitted for intent "unknown"
 *
 * So the entries above were correct and unreachable. Assert prompt → intent →
 * permitted_tools end to end; removing either parser branch fails these.
 */
describe('showcase chip prompts reach their own tool end to end', () => {
  const { extractIntentAndConfidence } = require('../../services/nlIntentParser');

  it.each([
    ["what's the weather in Austin, TX", 'get_weather'],
    ["what's the weather in Miami", 'get_weather'],
    ['what are the branch hours', 'get_branch_hours'],
    ['branch hours for my local branch', 'get_branch_hours'],
  ])('%s classifies as %s and permits it', (prompt, tool) => {
    const { intent } = extractIntentAndConfidence(prompt);
    expect(intent).toBe(tool);
    expect(permittedToolsForIntent(intent, 'banking')).toEqual([tool]);
  });

  // The branch-hours regex sits ABOVE the accounts/transactions reads on
  // purpose; these must not be stolen by it, nor it by them.
  it.each([
    ['show my balance', 'view_balance'],
    ['show my recent transactions', 'view_transactions'],
    ['show my accounts', 'view_accounts'],
  ])('%s still classifies as %s', (prompt, intent) => {
    expect(extractIntentAndConfidence(prompt).intent).toBe(intent);
  });
});
