'use strict';

/**
 * @file useCases.secondaryTools.test.js
 * @description A use case must declare EVERY gateway tool it calls, not just
 * the first one.
 *
 * The catalog uses primaryTool for its active protected actions and can declare
 * secondaryTools when a use case actually invokes additional gateway tools.
 *
 * The check is deliberately narrow to stay precise: a GATEWAY-surface tool name
 * appearing verbatim in the entry's own prose. Filtering to gateway surface is
 * what makes it usable -- scanning all of scope-topology instead matches the
 * English word "transfer" against the `transfer` legacy-alias entry in eight
 * unrelated use cases. Measured: all-tools = 9 hits (8 false), gateway-only = 1
 * hit (UC38, real).
 *
 * It is a FLOOR, not a ceiling: a use case describing a second tool in English
 * ("check the balance, then move the money") still declares nothing and this
 * cannot see it. Recorded in TECH_DEBT.
 */

const path = require('path');
const { USE_CASES, resolveUseCase, VERTICALS } = require('../config/useCases');

const topology = require(path.join(__dirname, '..', '..', 'scope-topology.json'));

const GATEWAY_TOOLS = Object.entries(topology.tools)
  .filter(([, v]) => v.surface === 'gateway')
  .map(([k]) => k);

const VERTICAL_IDS = (VERTICALS || []).map((v) => v.id || v);

/** Every tool an entry declares — primaryTool (base + per-vertical) + secondaryTools. */
function declaredTools(useCase) {
  const out = new Set();
  const add = (r) => {
    if (!r) return;
    if (r.primaryTool) out.add(r.primaryTool);
    for (const t of r.secondaryTools || []) out.add(t);
  };
  add(useCase);
  for (const v of VERTICAL_IDS) add(resolveUseCase(useCase.id, v) || null);
  return out;
}

/** Gateway tools this entry's own prose names. */
function namedInProse(useCase) {
  const text = [useCase.whatLong, useCase.what, useCase.businessValue, useCase.how]
    .filter(Boolean)
    .join(' ');
  return GATEWAY_TOOLS.filter((t) => text.includes(t));
}

describe('a use case declares every gateway tool it names', () => {
  it('has use cases and gateway tools to check (vacuity guard)', () => {
    // Either list emptying would make the sweep below pass having compared
    // nothing — the failure mode this area keeps producing.
    expect(USE_CASES.length).toBeGreaterThan(40);
    expect(GATEWAY_TOOLS.length).toBeGreaterThan(200);
    expect(VERTICAL_IDS.length).toBeGreaterThan(5);
  });

  it('no use case names a gateway tool it does not declare', () => {
    const violations = [];
    for (const u of USE_CASES) {
      const declared = declaredTools(u);
      for (const tool of namedInProse(u)) {
        if (!declared.has(tool)) violations.push(`${u.id} names ${tool} but declares [${[...declared].join(', ') || '-'}]`);
      }
    }
    // Add the tool to that entry's `secondaryTools` rather than deleting it from
    // the prose — an undeclared tool is invisible to the reachability gate and
    // will be denied at the gateway with intent_mismatch.
    expect(violations).toEqual([]);
  });
});

describe('UC38 — active workload action', () => {
  const uc38 = USE_CASES.find((u) => u.id === 'UC38');

  it('exists (vacuity guard)', () => {
    expect(uc38).toBeDefined();
  });

  it('resolves the airlines action through the workload-agent entry point', () => {
    const resolved = resolveUseCase('UC38', 'airlines');
    expect(resolved).toMatchObject({
      title: 'Workload Agent: MFA-gated protected action',
      primaryTool: 'pay_airline_fee',
      trigger: { path: '/workload-agents?useCase=UC38' },
    });
    expect(declaredTools(uc38).has(resolved.primaryTool)).toBe(true);
  });
});

describe('secondaryTools catalog plumbing', () => {
  it('preserves and validates any secondary tools the catalog declares', () => {
    for (const u of USE_CASES) {
      for (const vertical of VERTICAL_IDS) {
        const resolved = resolveUseCase(u.id, vertical);
        for (const tool of u.secondaryTools || []) {
          expect(resolved.secondaryTools).toContain(tool);
          expect(topology.tools[tool]).toBeDefined();
        }
      }
    }
  });
});
