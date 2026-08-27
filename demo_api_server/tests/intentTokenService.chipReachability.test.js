'use strict';

/**
 * @file intentTokenService.chipReachability.test.js
 * @description Every CHIP-driven gateway tool must be reachable by some intent.
 *
 * A tool no intent permits is denied by the gateway with
 *   intent_mismatch: tool "view_wishlist" not permitted for intent "view_wishlist"
 * because server.js mints intent = _TOOL_TO_INTENT[tool] || tool, and the
 * unknown-intent fallback (the vertical's non-sensitive reads) excludes them.
 *
 * The invariant is deliberately scoped to CHIPS, not to every gateway tool.
 * Measured 2026-08-26: 160 of 244 gateway-surface tools are intent-unreachable,
 * but only 17 drive a chip. Chips are the demo-reachable surface; asserting the
 * broader invariant would fail on 143 tools with no evidence any of them is
 * broken, and this file would then be noise rather than a gate.
 *
 * Two gates are independent and BOTH still apply after this:
 *   challengeType (consent / step_up)  — fires FIRST, unchanged here
 *   intent permitted_tools             — what this file is about
 * Verified live: sensitive_membership_details denies with consent-required, while
 * view_wishlist denied with intent_mismatch. Different gates, different messages.
 */

const path = require('path');
const {
  permittedToolsForIntent,
  INTENT_TO_PERMITTED_TOOLS,
  VERTICAL_INTENT_TO_PERMITTED_TOOLS,
} = require('../services/intentTokenService');
const { USE_CASES, resolveUseCase, VERTICALS } = require('../config/useCases');

const topology = require(path.join(__dirname, '..', '..', 'scope-topology.json'));

/** Every (tool, vertical) a chip can actually drive. */
function chipDrivenTools() {
  const out = new Map();
  const verticals = (VERTICALS || []).map((v) => v.id || v);
  for (const vertical of verticals) {
    for (const u of USE_CASES) {
      const r = resolveUseCase(u.id, vertical) || u;
      const t = r.trigger || {};
      if (t.type !== 'chip' || !t.text || !r.primaryTool) continue;
      if (topology.tools[r.primaryTool]?.surface !== 'gateway') continue;
      if (!out.has(r.primaryTool)) out.set(r.primaryTool, { vertical, useCase: u.id, text: t.text });
    }
  }
  return out;
}

const CHIPS = chipDrivenTools();

describe('chip-driven gateway tools are intent-reachable', () => {
  it('found chips to check (vacuity guard)', () => {
    // If the catalog shape changes and this returns nothing, the suite below
    // would pass by iterating zero cases — the exact silent-green shape this
    // area keeps producing.
    expect(CHIPS.size).toBeGreaterThan(20);
  });

  const cases = [...CHIPS.entries()].map(([tool, meta]) => [tool, meta.vertical, meta.useCase]);

  // The invariant is "SOME intent permits this tool", not "the tool name does".
  // server.js maps ~48 tools to a different intent label (create_transfer ->
  // transfer, show_mortgage -> view_mortgage, request_fee_waiver ->
  // request_waiver), and those are permitted under the override. Asserting the
  // tool name specifically would duplicate that map here and fail on exactly
  // those — which it did on the first run.
  const reachableTools = (() => {
    const reach = new Set();
    for (const list of Object.values(INTENT_TO_PERMITTED_TOOLS || {})) {
      (list || []).forEach((t) => reach.add(t));
    }
    for (const perVertical of Object.values(VERTICAL_INTENT_TO_PERMITTED_TOOLS || {})) {
      for (const list of Object.values(perVertical || {})) (list || []).forEach((t) => reach.add(t));
    }
    return reach;
  })();

  it.each(cases)('%s (%s, %s) is permitted by some intent', (tool) => {
    expect(reachableTools.has(tool)).toBe(true);
  });
});

describe('the new entries stay least-privilege', () => {
  const ADDED = [
    'get_weather', 'get_branch_hours',
    'redeem_miles', 'request_document', 'request_fee_tier_review',
    'request_housing_assignment', 'request_price_adjustment', 'request_schedule_change',
    'request_spec_exception', 'submit_filing', 'view_wishlist',
    'sensitive_holdings', 'sensitive_membership_details', 'sensitive_order_history',
    'sensitive_passenger_record', 'sensitive_patient_records', 'sensitive_payroll_details',
    'sensitive_student_finance', 'sensitive_supplier_contract',
  ];

  it.each(ADDED)('%s grants exactly itself and nothing else', (tool) => {
    expect(INTENT_TO_PERMITTED_TOOLS[tool]).toEqual([tool]);
  });

  // Mapping an intent must not have quietly removed a challenge. consent/step_up
  // is a separate gate and is what actually protects the sensitive tools.
  it('the consent-gated tools still carry their challengeType', () => {
    for (const t of ADDED.filter((x) => x.startsWith('sensitive_'))) {
      expect(topology.tools[t].challengeType).toBe('consent');
    }
  });

  it('the unknown-intent fallback still excludes them', () => {
    const fallback = permittedToolsForIntent('some_unclassified_intent', 'banking');
    for (const t of ADDED) expect(fallback).not.toContain(t);
  });
});

// ── Secondary tools ──────────────────────────────────────────────────────────
// Derived from the catalog, not hand-listed. Use cases now declare every
// gateway tool they call via `secondaryTools` (useCases.js), so this sweep
// covers a new multi-tool use case the moment it is added -- the same guarantee
// the primaryTool sweep above already had.
//
// It used to be a hand-written array of one, because nothing declared secondary
// tools at all. That was the gap: UC38's get_loyalty_status was invisible to
// every gate and stayed intent-unreachable through two rounds of fixes, found by
// driving the live stack rather than by a test. `useCases.secondaryTools.test.js`
// now fails if an entry's prose names a gateway tool it does not declare, so the
// list this reads from cannot silently fall behind.
describe('declared secondary tools are intent-reachable too', () => {
  const cases = [];
  for (const u of USE_CASES) {
    const verticals = (VERTICALS || []).map((v) => v.id || v);
    for (const vertical of verticals) {
      const r = resolveUseCase(u.id, vertical) || u;
      for (const tool of r.secondaryTools || []) {
        if (topology.tools[tool]?.surface !== 'gateway') continue;
        if (!cases.some(([t, v]) => t === tool && v === vertical)) cases.push([tool, vertical, u.id]);
      }
    }
  }

  it('found declared secondary tools to check (vacuity guard)', () => {
    // If `secondaryTools` is dropped from the catalog or stripped by
    // resolveUseCase, every it.each below would iterate zero cases and pass.
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some(([tool]) => tool === 'get_loyalty_status')).toBe(true);
  });

  it.each(cases)('%s (%s, %s) is permitted by its own intent', (tool, vertical) => {
    expect(permittedToolsForIntent(tool, vertical)).toContain(tool);
  });
});
