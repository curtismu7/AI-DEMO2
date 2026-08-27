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
// The gate above derives from primaryTool, which is the ONLY tool a use case
// declares machine-readably. UC38 runs two: its own whatLong says the agent
// "calls get_loyalty_status to check the miles balance and redeem_miles to
// upgrade the cabin". Only redeem_miles is declared, so get_loyalty_status was
// invisible to the gate and stayed intent-unreachable after the first pass --
// found live, not by any test.
//
// This list is hand-written BECAUSE nothing declares secondary tools; that is
// the actual gap, recorded in TECH_DEBT. Until a use case can declare them, a
// short explicit list beats no coverage. Keep it small: add an entry only for a
// tool a use case's own text says it calls.
describe('secondary tools named in a use case are reachable too', () => {
  const SECONDARY = [['UC38', 'airlines', 'get_loyalty_status']];

  it.each(SECONDARY)('%s (%s) can reach %s', (_uc, vertical, tool) => {
    expect(permittedToolsForIntent(tool, vertical)).toContain(tool);
  });

  // Least privilege, same rule as every other entry in this file.
  it.each(SECONDARY)('%s (%s): %s grants exactly itself', (_uc, _vertical, tool) => {
    expect(INTENT_TO_PERMITTED_TOOLS[tool]).toEqual([tool]);
  });

  // The claim above is that the use case's own text names the tool. If someone
  // rewrites UC38 so it no longer does, this entry needs rejustifying.
  it('UC38 still names get_loyalty_status in its own description', () => {
    const uc38 = USE_CASES.find((u) => u.id === 'UC38');
    expect(uc38).toBeDefined();
    expect(`${uc38.whatLong || ''} ${uc38.what || ''}`).toContain('get_loyalty_status');
  });
});
