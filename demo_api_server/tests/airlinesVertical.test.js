'use strict';

/**
 * The airlines vertical is the first one whose data lives in a database owned by
 * demo_mcp_resource_server rather than in a local seed store. These assertions
 * pin the wiring that makes that true — each one guards a failure that would
 * otherwise show up as an empty chip or a confusing "Unknown tool".
 */

const path = require('path');
const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

const scopeTopology = require('../services/scopeTopology');
const plugin = require('../config/verticals/airlines');
const manifest = require('../config/verticals/airlines/manifest.json');

/** Tools the airlines vertical gates on airlines:read (alone or with more). */
const AIRLINES_TOOLS = [
  'get_airline_bookings',      // plain read — ungated
  'cancel_airline_reservation', // Phase 2 write — step-up (MFA)
  'pay_airline_fee',            // Phase 2 amount-gated write — ladder decides
  'sensitive_airline_bookings', // Phase 2 sensitive read — HITL consent
  'get_flight_status',
  'check_seat_availability',
];
/** The A2A-delegated tool. Gated on its OWN scope, never on airlines:read. */
const A2A_TOOL = 'sensitive_passenger_record';
const ALL_TOOLS = [...AIRLINES_TOOLS, A2A_TOOL];

describe('airlines vertical', () => {
  test('satisfies the plugin contract', () => {
    const { validatePlugin } = require('../services/verticalManifest/pluginContract');
    expect(validatePlugin('airlines', plugin)).toEqual({ ok: true, errors: [] });
  });

  test('declares the four resource-server tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(ALL_TOOLS));
  });

  // The whole point of the vertical: it must NOT answer these locally, or the
  // chip would render a seed value and the SQLite database would never be read.
  test.each(ALL_TOOLS)('%s is handed to the MCP executor, not answered locally', async (name) => {
    await expect(plugin.executeTool(name, {}, {})).resolves.toBe(NOT_MY_TOOL);
  });

  test('has no local data store', () => {
    expect(plugin.getDataStore().get('any-user')).toEqual({});
  });

  test('every chip tool is declared in scope-topology and routed at the gateway', () => {
    const chipTools = manifest.dashboard.chips10.map((c) => c.tool);
    expect(chipTools).toEqual(ALL_TOOLS);
    for (const tool of AIRLINES_TOOLS) {
      // The Phase-2 sensitive read carries sensitive:read ON TOP of airlines:read —
      // that extra scope is what separates it from the ungated lookup, so assert
      // airlines:read is present rather than that it is the only scope.
      expect(scopeTopology.toolScopes(tool)).toContain('airlines:read');
      expect(scopeTopology.toolSurface(tool)).toBe('gateway');
    }
    expect(scopeTopology.toolScopes('sensitive_airline_bookings')).toContain('sensitive:read');
    // The A2A record is the ONE airlines tool outside that set: no amount of
    // airlines:read reaches it, which is what makes the delegation load-bearing.
    expect(scopeTopology.toolScopes(A2A_TOOL)).not.toContain('airlines:read');
  });

  /**
   * The A2A claim, stated as a scope fact rather than as prose: the specialist's
   * requested scope is DERIVED from scope-topology and must be its own — never
   * the coarse `read` every session token already holds. Collapsing it to `read`
   * would make the chip answerable without the delegation chain, which is the
   * regression REGRESSION_PLAN §4 (2026-07-27) records.
   */
  test('the sensitive record carries a dedicated A2A scope, not bare read', () => {
    expect(scopeTopology.a2aDelegatedScope(A2A_TOOL)).toBe('pnr:read');
    expect(scopeTopology.toolSurface(A2A_TOOL)).toBe('gateway');
    expect(scopeTopology.a2aDelegatedScope(A2A_TOOL)).not.toBe('read');

    const { specialistForVertical } = require('../config/a2aSpecialists');
    const specialist = specialistForVertical('airlines');
    expect(specialist.tools).toEqual([A2A_TOOL]);
    expect(specialist.appKey).toBe('passenger');

    const { deriveSpecialistScopes } = require('../services/a2aDelegationService');
    expect(deriveSpecialistScopes(specialist)).toEqual(['pnr:read']);
  });

  /**
   * configStore's env allowlist + alias map are hand-maintained per specialist,
   * so a new specialist resolves NO credentials until three entries are added —
   * and the failure is silent: resolveA2aConfig reports the app "not configured"
   * exactly as it does when the PingOne app genuinely does not exist, so a real
   * wiring gap is indistinguishable from an unprovisioned environment.
   *
   * Enumerated from the registry, not listed, so specialist eleven fails here
   * the day it lands rather than at a demo.
   */
  test('every A2A specialist can resolve its credentials and audience from env', () => {
    const configStore = require('../services/configStore');
    const {
      A2A_SPECIALISTS, clientIdKey, clientSecretKey, intermediateAudienceKey,
    } = require('../config/a2aSpecialists');

    const missing = [];
    for (const spec of Object.values(A2A_SPECIALISTS)) {
      const KEY = spec.appKey.toUpperCase();
      const cases = [
        [`PINGONE_A2A_${KEY}_AGENT_CLIENT_ID`, clientIdKey(spec.appKey)],
        [`PINGONE_A2A_${KEY}_AGENT_CLIENT_SECRET`, clientSecretKey(spec.appKey)],
        [`A2A_INTERMEDIATE_AUDIENCE_${KEY}`, intermediateAudienceKey(spec.appKey)],
      ];
      for (const [envVar, storeKey] of cases) {
        const sentinel = `sentinel-${spec.appKey}-${envVar}`;
        const had = Object.prototype.hasOwnProperty.call(process.env, envVar);
        const prev = process.env[envVar];
        process.env[envVar] = sentinel;
        try {
          if (configStore.getEffective(storeKey) !== sentinel) missing.push(`${envVar} -> ${storeKey}`);
        } finally {
          if (had) process.env[envVar] = prev; else delete process.env[envVar];
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The gateway routes by tool NAME. Left out of AIRLINES_TOOLS there, the
   * sensitive tool falls through to the default 'olb' target, is relayed to the
   * BFF, and the airlines plugin disowns it — so a fully valid nested-act
   * exchange ends in "no handler for sensitive_passenger_record".
   */
  test('the gateway routes the sensitive tool to the resource server', () => {
    const routerPath = path.join(__dirname, '..', '..', 'demo_mcp_gateway', 'src', 'router.ts');
    const src = require('fs').readFileSync(routerPath, 'utf8');
    const block = src.slice(src.indexOf('const AIRLINES_TOOLS'), src.indexOf('const JWT_VERIFIER_TOOLS'));
    for (const name of ALL_TOOLS) expect(block).toContain(`'${name}'`);
  });

  // featureScope is the only scope config/oauthUser.js appends to the user's
  // /authorize request. Without it the user token never carries airlines:read
  // and the RFC 8693 intersection drops it before the resource server is called.
  test('featureScope puts airlines:read on the user token', () => {
    expect(manifest.scopes.featureScope).toBe('airlines:read');
  });

  test('the agent token requests airlines:read for this vertical', () => {
    const { verticalManifest } = require('../services/verticalManifest');
    verticalManifest.init();
    const { resolveAgentScopes } = require('../services/agentScopes');
    expect(resolveAgentScopes('airlines', false)).toContain('airlines:read');
  });

  test('the fee heuristic extracts the amount and outranks cancel', () => {
    const fee = plugin.getHeuristics().find((h) => h.action === 'pay_airline_fee');
    expect(fee).toBeDefined();
    expect(fee.extractsAmount).toBe(true);

    const feeIndex = plugin.getHeuristics().findIndex((h) => h.action === 'pay_airline_fee');
    const cancelIndex = plugin.getHeuristics().findIndex((h) => h.action === 'cancel_airline_reservation');
    expect(feeIndex).toBeLessThan(cancelIndex);
  });

  // The catalog's amount trigger for this vertical. If the regex stops matching
  // it, UC6/7/8/22 fall through to the LLM and the demo silently loses its
  // DENY / step-up / consent proof.
  test.each([
    'pay a $300 change fee',
    'pay a $2500 change fee',
    'pay the $60 bag fee',
  ])('%s routes to pay_airline_fee', (phrase) => {
    const hit = plugin.getHeuristics().find((h) => h.re.test(phrase));
    expect(hit && hit.action).toBe('pay_airline_fee');
  });

  // "refund fee" contains `refund`, which the cancel rule also matches.
  test('a refund fee is a fee payment, not a cancellation', () => {
    const hit = plugin.getHeuristics().find((h) => h.re.test('pay the $75 refund fee'));
    expect(hit.action).toBe('pay_airline_fee');
  });

  // Without this entry _applyTransactionPolicy returns early on a null
  // transactionType, so $2500 PERMITs and UC6/7/8/22 all silently pass.
  test('pay_airline_fee is on the transaction-policy path', () => {
    const { WRITE_TOOL_TYPE_MAP } = require('../services/mcpToolAuthorizationService');
    expect(WRITE_TOOL_TYPE_MAP.pay_airline_fee).toBe('transfer');
  });

  test('pay_airline_fee is gateway-surfaced and scoped like the cancel write', () => {
    expect(scopeTopology.toolScopes('pay_airline_fee')).toEqual(['airlines:read', 'airlines:write']);
    expect(scopeTopology.toolSurface('pay_airline_fee')).toBe('gateway');
  });

  // pay_airline_fee declares step_up so live P1AZ includes it in RequiresMcpStepUp
  // (the MCP Delegation policy condition). The amount ladder still decides for
  // amount-bearing calls: declaresStepUp in decision.js only fires when !hasAmount,
  // so UC6 ($2500 DENY) and UC8 ($300 HITL) are unaffected.
  test('pay_airline_fee declares step_up challengeType for RequiresMcpStepUp', () => {
    const topology = require('../../scope-topology.json');
    expect(topology.tools.pay_airline_fee.challengeType).toBe('step_up');
  });

  test('the resource server declares the same tools and scope', () => {
    const toolsPath = path.join(__dirname, '..', '..', 'demo_mcp_resource_server', 'src', 'tools', 'airlinesTools.ts');
    const src = require('fs').readFileSync(toolsPath, 'utf8');
    for (const name of ALL_TOOLS) expect(src).toContain(`name: '${name}'`);
    expect(src).toContain("requiredScopes: ['airlines:read']");
    // Enforced at the far end of the chain too: the record is unreachable
    // without pnr:read, so no airlines:read token can ever be answered with it.
    expect(src).toContain("requiredScopes: ['pnr:read']");
  });

  /**
   * oauth-mcp/ IS the live `mcp-server` container, and BankingToolProvider reads
   * a2aDelegatedScope from its own copy of the generated catalog. A stale copy
   * leaves the specialist's Exchange #2 bearer rejected for insufficient scope
   * while every static check stays green.
   *
   * This used to loop over demo_mcp_server too — a duplicate tree the generator
   * wrote INSTEAD of oauth-mcp, which is how the live copy went three tools
   * stale when this vertical landed. That tree is gone and the generator now
   * writes the live one, so there is a single catalog to assert on.
   */
  test('the generated MCP catalog carries the tool and its delegated scope', () => {
    const fs = require('fs');
    const svc = 'oauth-mcp';
    const p = path.join(__dirname, '..', '..', svc, 'src', 'tools', 'handlers', 'verticalTools.generated.ts');
    const src = fs.readFileSync(p, 'utf8');
    for (const name of ALL_TOOLS) expect(`${svc}:${src.includes(`"name":"${name}"`)}`).toBe(`${svc}:true`);
    expect(src).toContain('"name":"sensitive_passenger_record","scope":"read","vertical":"airlines","a2aDelegatedScope":"pnr:read"');
  });
});
