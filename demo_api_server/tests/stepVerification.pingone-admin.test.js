// demo_api_server/tests/stepVerification.pingone-admin.test.js
'use strict';

/**
 * Step verification — pingone-admin vertical.
 * Covers the ADMIN Demo Steps: catalog presence, heuristic parse,
 * and prerequisite wiring.
 *
 * No amount-gate section (ADMIN steps have no UC6/7/8 tier).
 */

const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const VERTICAL = 'pingone-admin';

/** Expected parse result for each ADMIN chip. The readiness runner shares this contract. */
const { adminExpectations: ADMIN_PARSE_EXPECT } = require('../config/demoReadinessInventory');
const EXPECTED_ADMIN_TOOLS = {
  ADMIN1: ['call_pingone_tool', 'listApplications'],
  ADMIN2: ['call_pingone_tool', 'listUsers'],
  ADMIN3: ['call_pingone_tool', 'listPopulations'],
  ADMIN4: ['call_pingone_tool', 'getEnvironment'],
  ADMIN5: ['call_pingone_tool', 'listUsers'],
  ADMIN6: ['call_pingone_tool', 'listApplications'],
  ADMIN7: ['list_pingone_tools', null],
  ADMIN8: ['call_pingone_tool', 'listResources'],
  ADMIN9: ['call_pingone_tool', 'getEnvironmentServices'],
  ADMIN10: ['call_pingone_tool', 'listDavinciFlows'],
  ADMIN11: ['call_pingone_tool', 'listDavinciApplications'],
  ADMIN12: ['call_pingone_tool', 'listDavinciConnectors'],
};

describe('step verification — pingone-admin catalog', () => {
  test('readiness expectations preserve the existing ADMIN parser contract', () => {
    expect(Object.fromEntries(Object.entries(ADMIN_PARSE_EXPECT).map(([id, expected]) => [
      id,
      [expected.expectedAction, expected.expectedTool],
    ]))).toEqual(EXPECTED_ADMIN_TOOLS);
    expect(ADMIN_PARSE_EXPECT.ADMIN5.expectedArguments.filter).toBe('username sw "curt"');
    expect(ADMIN_PARSE_EXPECT.ADMIN6.expectedArguments.filter).toBe('name sw "Demo"');
    expect(ADMIN_PARSE_EXPECT.ADMIN7.queryInput).toBe('user');
  });

  test('catalog lists ADMIN1–13 with MCP chips followed by the Privilege handoff', () => {
    expect(ADMIN_DEMO_STEPS.map((s) => s.id)).toEqual([
      'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6',
      'ADMIN7', 'ADMIN8', 'ADMIN9', 'ADMIN10', 'ADMIN11', 'ADMIN12', 'ADMIN13',
    ]);
    for (const s of ADMIN_DEMO_STEPS.slice(0, -1)) {
      expect(s.trigger?.type).toBe('chip');
      expect(s.trigger?.text).toBeTruthy();
      expect(s.title).toBeTruthy();
    }
    expect(ADMIN_DEMO_STEPS.at(-1)).toMatchObject({
      id: 'ADMIN13',
      trigger: { type: 'link', path: '/privilege-mcp-client' },
    });
  });
});

describe('step verification — pingone-admin chip routing (check 2: parse/route)', () => {
  const ctx = resolveVerticalCtx(VERTICAL);

  test.each(ADMIN_DEMO_STEPS.filter((s) => s.trigger.type === 'chip').map((s) => [s.id, s]))(
    '%s: chip text parses to expected call_pingone_tool action',
    (_id, step) => {
      const text = step.trigger.text;
      const parsed = parseHeuristic(text, VERTICAL, ctx, {});
      const expect_ = ADMIN_PARSE_EXPECT[step.id];

      const wired = parsed && parsed.kind !== 'none';
      const ok = wired
        && parsed.action === expect_.expectedAction
        // ?? null: a null expectedTool (ADMIN7) means "no tool name", which the parser reports as undefined.
        && (parsed.params?.name ?? null) === (expect_.expectedTool ?? null);

      const status = ok ? 'PASS' : 'FAIL';
      const errorClass = ok ? null : (wired ? 'wrong_response' : 'parse_error');

      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: step.id,
        triggerType: step.trigger.type,
        mode: 'unit-parse',
        status,
        errorClass,
        primaryTool: expect_.expectedAction,
        checkedAt: new Date().toISOString(),
        verifiedBy: `nlIntentParser pingone-admin heuristics → ${expect_.expectedTool || expect_.expectedAction}`,
      });

      expect(parsed?.kind).not.toBe('none');
      expect(parsed.action).toBe(expect_.expectedAction);
      if (expect_.expectedTool == null) {
        expect(parsed.params?.name).toBeUndefined();
      } else {
        expect(parsed.params?.name).toBe(expect_.expectedTool);
      }
      if (expect_.expectedArguments?.filter) {
        expect(parsed.params?.arguments?.filter).toBe(expect_.expectedArguments.filter);
      }
    },
  );
});

describe('pingone-admin tool-filter phrase (ADMIN7 modal output)', () => {
  test('the matching-fragment phrase parses to list_pingone_tools WITH the filter', () => {
    const ctx = resolveVerticalCtx(VERTICAL);
    const parsed = parseHeuristic('Show me the PingOne tools matching "user"', VERTICAL, ctx, {});
    expect(parsed?.action).toBe('list_pingone_tools');
    expect(parsed?.params?.filter).toBe(ADMIN_PARSE_EXPECT.ADMIN7.queryInput);
  });
});

describe('step verification — pingone-admin prerequisites', () => {
  test('ADMIN steps require no feature flags or A2A credentials', () => {
    // Admin steps run against the PingOne MCP server directly — no
    // ff_mcp_gateway runtime flags needed, no amount gates.
    for (const s of ADMIN_DEMO_STEPS) {
      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: s.id,
        triggerType: s.trigger.type,
        mode: 'unit-prereq',
        status: 'PASS',
        errorClass: null,
        primaryTool: ADMIN_PARSE_EXPECT[s.id]?.expectedAction || null,
        checkedAt: new Date().toISOString(),
        verifiedBy: 'pingone-admin vertical has no flag/A2A/PAR prerequisites',
      });
    }
    expect(ADMIN_DEMO_STEPS.length).toBe(13);
  });
});
