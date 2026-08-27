'use strict';

/**
 * @file intentTokenService.dispatchableGrant.test.js
 * @description The derived self-grant: a tool a vertical can dispatch is
 * permitted by its own intent, and nothing else is.
 *
 * Context. server.js mints `intent = _TOOL_TO_INTENT[tool] || tool`. A tool with
 * no entry in either intent map minted its own name, missed both, fell through
 * to the vertical's read-only list -- which excludes it -- and was denied.
 * Measured 2026-08-27: 142 of 244 gateway tools, of which 99 are reachable by an
 * ordinary typed phrase. Driven live in Super Sports, five for five routed
 * correctly and then 403'd with IntentMatchesTool "false".
 *
 * These tests are about the MECHANISM, not a list of tools. Asserting a list
 * would recreate by hand the thing the mechanism exists to derive.
 */

const path = require('path');
const {
  permittedToolsForIntent,
  INTENT_TO_PERMITTED_TOOLS,
} = require('../services/intentTokenService');

const topology = require(path.join(__dirname, '..', '..', 'scope-topology.json'));

/** Rebuild the expectation independently of the implementation. */
function dispatchable(vertical) {
  const plugin = require(path.join(__dirname, '..', 'config', 'verticals', vertical));
  const out = new Set();
  const isGw = (n) => topology.tools[n] && topology.tools[n].surface === 'gateway';
  for (const h of plugin.getHeuristics()) if (h && h.action && isGw(h.action)) out.add(h.action);
  for (const t of plugin.getTools()) if (t && t.name && isGw(t.name)) out.add(t.name);
  return out;
}

// Super Sports is the repo's default vertical for manual validation, and is
// where the five live denials were measured.
const SPORTING = [...dispatchable('sporting-goods')];

describe('dispatchable tools are permitted by their own intent', () => {
  it('found tools to check (vacuity guard)', () => {
    // If the plugin shape changes and this returns nothing, every it.each below
    // passes by iterating zero cases.
    // 30 today: 25 from getHeuristics() + 5 more from getTools(). The floor is
    // the heuristic count, so losing the getTools() half alone would not trip
    // this, but losing plugin loading entirely -- the failure that matters --
    // takes it to 0.
    expect(SPORTING.length).toBeGreaterThanOrEqual(25);
  });

  it.each(SPORTING)('%s is permitted in sporting-goods', (tool) => {
    expect(permittedToolsForIntent(tool, 'sporting-goods')).toContain(tool);
  });

  // Least privilege: the grant is one tool, never a widening. A tool that also
  // has an explicit map entry legitimately gets that entry's list instead.
  it.each(SPORTING)('%s grants only itself unless explicitly mapped', (tool) => {
    const permitted = permittedToolsForIntent(tool, 'sporting-goods');
    if (INTENT_TO_PERMITTED_TOOLS[tool]) return; // explicit entry wins, by design
    expect(permitted).toEqual([tool]);
  });
});

describe('the grant does not leak across verticals or open the fallback', () => {
  it('a retail-only tool is NOT granted in banking', () => {
    // list_wishlist is dispatchable in sporting-goods/retail, not in banking.
    // Without per-vertical scoping this would be permitted everywhere.
    expect(permittedToolsForIntent('list_wishlist', 'sporting-goods')).toContain('list_wishlist');
    expect(permittedToolsForIntent('list_wishlist', 'banking')).not.toContain('list_wishlist');
  });

  it('an unknown intent still fails closed', () => {
    const permitted = permittedToolsForIntent('totally_made_up_tool', 'sporting-goods');
    expect(permitted).not.toContain('totally_made_up_tool');
    // and it is the read-only fallback, not an empty allow-anything result
    expect(permitted.length).toBeGreaterThan(0);
  });

  it('an unknown vertical falls back rather than granting', () => {
    expect(permittedToolsForIntent('list_wishlist', 'no-such-vertical'))
      .not.toContain('list_wishlist');
  });

  // The fallback's own narrowing is a real control (it stopped cross-vertical
  // exposure of get_sensitive_account_details / query_user_by_email). The grant
  // must not have widened it.
  it('the read-only fallback is unchanged for an unclassified intent', () => {
    const fallback = permittedToolsForIntent('some_unclassified_intent', 'banking');
    expect(fallback).not.toContain('get_sensitive_account_details');
    expect(fallback).not.toContain('query_user_by_email');
  });

  it('leaves an explicitly mapped intent alone', () => {
    expect(permittedToolsForIntent('view_balance', 'banking'))
      .toEqual(['get_account_balance', 'get_my_accounts']);
  });
});

describe('the grant does not touch the other gates', () => {
  // Granting an intent cannot weaken consent, step-up or A2A delegation --
  // those are separate fields on the tool, read by the gateway, not by this
  // service. Verified live: sensitive_membership_details denies with
  // "A2A Delegation Required" while its intent validates.
  it('consent-gated dispatchable tools still declare challengeType', () => {
    const gated = SPORTING.filter((t) => topology.tools[t].challengeType);
    expect(gated.length).toBeGreaterThan(0); // vacuity guard
    for (const t of gated) {
      expect(['consent', 'step_up']).toContain(topology.tools[t].challengeType);
    }
  });

  it('A2A-delegated dispatchable tools keep their delegated scope', () => {
    const a2a = SPORTING.filter((t) => topology.tools[t].a2aDelegated);
    expect(a2a.length).toBeGreaterThan(0); // vacuity guard
    for (const t of a2a) {
      expect(typeof topology.tools[t].a2aDelegatedScope).toBe('string');
      expect(topology.tools[t].a2aDelegatedScope).not.toBe('read');
    }
  });
});
