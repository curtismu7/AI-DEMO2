'use strict';

/**
 * @file airlinesThreeTier.regression.test.js
 * @description Airlines runs THREE sensitivity tiers, not two. Guards
 * REGRESSION_PLAN.md §1 "Airlines is THREE tiers, not two".
 *
 * Why this exists: the asymmetry reads as a defect and has already been filed as
 * one (TECH_DEBT 2026-08-26, withdrawn 2026-08-27). Ten sensitive_* tools are
 * A2A-delegated and sensitive_airline_bookings is not, so it looks like the odd
 * one out. It is not -- the ten are one A2A specialist tool PER VERTICAL, and
 * airlines' slot is already sensitive_passenger_record.
 *
 * Converting sensitive_airline_bookings would add requiresAgentMediation, which
 * DENIES any call with no act claim (demo_authz_server/routes/decision.js,
 * REQUIRE_ACT_FOR_AGENT_TOOLS defaults on). That kills the "Sensitive
 * reservations" consent chip -- airlines' HITL-consent demo -- and duplicates
 * what sensitive_passenger_record already demonstrates.
 *
 * A prose note alone would not stop it. This fails first.
 */

const path = require('path');

const topology = require(path.join(__dirname, '..', '..', 'scope-topology.json'));
const manifest = require(path.join(__dirname, '..', 'config', 'verticals', 'airlines', 'manifest.json'));
const specialists = require('../config/a2aSpecialists');

const PLAIN = 'get_airline_bookings';
const CONSENT = 'sensitive_airline_bookings';
const A2A = 'sensitive_passenger_record';

describe('airlines keeps three distinct sensitivity tiers', () => {
  it('tier 1 — the plain lookup stays ungated', () => {
    expect(topology.tools[PLAIN].requiredScopes).toEqual(['airlines:read']);
    expect(topology.tools[PLAIN].challengeType).toBeUndefined();
    expect(topology.tools[PLAIN].requiresAgentMediation).toBeFalsy();
  });

  it('tier 2 — the consent tier prompts a human and does NOT require an agent', () => {
    const t = topology.tools[CONSENT];
    expect(t.challengeType).toBe('consent');
    expect(t.requiredScopes).toEqual(['airlines:read', 'sensitive:read']);
    // The load-bearing assertion. requiresAgentMediation here would deny the
    // consent chip with missing_act.
    expect(t.requiresAgentMediation).toBeFalsy();
    expect(t.a2aDelegated).toBeFalsy();
    expect(t.a2aDelegatedScope).toBeUndefined();
  });

  it('tier 3 — the A2A tier is reachable ONLY through the delegation chain', () => {
    const t = topology.tools[A2A];
    expect(t.requiresAgentMediation).toBe(true);
    expect(t.a2aDelegated).toBe(true);
    expect(t.a2aDelegatedScope).toBe('pnr:read');
    // Never a coarse scope -- REGRESSION_PLAN: "never let an A2A specialist's
    // derived scope be read or write, that is the whole demo".
    expect(['read', 'write']).not.toContain(t.a2aDelegatedScope);
  });
});

describe('the two sensitive tiers drive two different demos', () => {
  // The manifest holds several chip arrays (`chips`, `chips10`, ...) and these
  // two live in `chips10`. Scan every array under `dashboard` rather than
  // naming one key, so moving a chip between variants does not silently drop
  // this guard to "chip not found".
  const chipFor = (tool) => {
    for (const value of Object.values(manifest.dashboard || {})) {
      if (!Array.isArray(value)) continue;
      const hit = value.find((c) => c && c.tool === tool);
      if (hit) return hit;
    }
    return undefined;
  };

  it('found the chips (vacuity guard)', () => {
    // If the manifest shape changes, the useCaseId assertions below would pass
    // vacuously on undefined.
    expect(chipFor(CONSENT)).toBeDefined();
    expect(chipFor(A2A)).toBeDefined();
  });

  it('the consent chip belongs to hitl-consent', () => {
    expect(chipFor(CONSENT).useCaseId).toBe('hitl-consent');
  });

  it('the A2A chip belongs to a2a-delegation', () => {
    expect(chipFor(A2A).useCaseId).toBe('a2a-delegation');
  });

  it('they are not the same use case', () => {
    expect(chipFor(CONSENT).useCaseId).not.toBe(chipFor(A2A).useCaseId);
  });
});

describe('the airlines A2A specialist slot is already filled', () => {
  const airlines = (specialists.A2A_SPECIALISTS || specialists).airlines;

  it('exists and owns the passenger record (vacuity guard)', () => {
    expect(airlines).toBeDefined();
    expect(airlines.tools).toContain(A2A);
  });

  // Adding CONSENT here is the other half of "aligning" it. Doing so without
  // provisioning a delegated scope on the live Super Banking A2A MCP Gateway
  // resource kills Exchange #2 with invalid_scope -- a live failure no unit test
  // would otherwise catch.
  it('does not own the consent-tier tool', () => {
    expect(airlines.tools).not.toContain(CONSENT);
  });
});
