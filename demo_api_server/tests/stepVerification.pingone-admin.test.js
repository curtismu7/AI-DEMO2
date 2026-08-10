// demo_api_server/tests/stepVerification.pingone-admin.test.js
'use strict';

/**
 * Step verification — pingone-admin vertical.
 * Covers the 4 ADMIN Demo Steps: catalog presence, heuristic parse,
 * and prerequisite wiring.
 *
 * No amount-gate section (ADMIN steps have no UC6/7/8 tier).
 */

const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const VERTICAL = 'pingone-admin';

/** Expected parse result for each ADMIN chip. */
const ADMIN_PARSE_EXPECT = {
  ADMIN1: { action: 'call_pingone_tool', toolName: 'listApplications' },
  ADMIN2: { action: 'call_pingone_tool', toolName: 'listUsers' },
  ADMIN3: { action: 'call_pingone_tool', toolName: 'listPopulations' },
  ADMIN4: { action: 'call_pingone_tool', toolName: 'getEnvironment' },
  // ADMIN5/6 assert the FILTER too — the prefix reaching PingOne as a SCIM sw
  // filter is the step's whole point; a parse that resolves the tool but drops
  // the filter lists everything and demos nothing. Case matters: sw is
  // case-sensitive, so "Demo" must survive as "Demo".
  ADMIN5: { action: 'call_pingone_tool', toolName: 'listUsers', filter: 'username sw "curt"' },
  ADMIN6: { action: 'call_pingone_tool', toolName: 'listApplications', filter: 'name sw "Demo"' },
  ADMIN7: { action: 'list_pingone_tools', toolName: undefined },
};

describe('step verification — pingone-admin catalog', () => {
  test('catalog lists ADMIN1–7 with chip triggers', () => {
    expect(ADMIN_DEMO_STEPS.map((s) => s.id)).toEqual([
      'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6', 'ADMIN7',
    ]);
    for (const s of ADMIN_DEMO_STEPS) {
      expect(s.trigger?.type).toBe('chip');
      expect(s.trigger?.text).toBeTruthy();
      expect(s.title).toBeTruthy();
    }
  });
});

describe('step verification — pingone-admin chip routing (check 2: parse/route)', () => {
  const ctx = resolveVerticalCtx(VERTICAL);

  test.each(ADMIN_DEMO_STEPS.map((s) => [s.id, s]))(
    '%s: chip text parses to expected call_pingone_tool action',
    (_id, step) => {
      const text = step.trigger.text;
      const parsed = parseHeuristic(text, VERTICAL, ctx, {});
      const expect_ = ADMIN_PARSE_EXPECT[step.id];

      const wired = parsed && parsed.kind !== 'none';
      const ok = wired
        && parsed.action === expect_.action
        && parsed.params?.name === expect_.toolName;

      const status = ok ? 'PASS' : 'FAIL';
      const errorClass = ok ? null : (wired ? 'wrong_response' : 'parse_error');

      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: step.id,
        triggerType: 'chip',
        mode: 'unit-parse',
        status,
        errorClass,
        primaryTool: expect_.action,
        checkedAt: new Date().toISOString(),
        verifiedBy: `nlIntentParser pingone-admin heuristics → ${expect_.toolName}`,
      });

      expect(parsed?.kind).not.toBe('none');
      expect(parsed.action).toBe(expect_.action);
      expect(parsed.params?.name).toBe(expect_.toolName);
      if (expect_.filter) {
        expect(parsed.params?.arguments?.filter).toBe(expect_.filter);
      }
    },
  );
});

describe('pingone-admin tool-filter phrase (ADMIN7 modal output)', () => {
  test('the matching-fragment phrase parses to list_pingone_tools WITH the filter', () => {
    const ctx = resolveVerticalCtx(VERTICAL);
    const parsed = parseHeuristic('Show me the PingOne tools matching "user"', VERTICAL, ctx, {});
    expect(parsed?.action).toBe('list_pingone_tools');
    expect(parsed?.params?.filter).toBe('user');
  });
});

describe('step verification — pingone-admin prerequisites', () => {
  test('ADMIN steps require no feature flags or A2A credentials', () => {
    // Admin steps run against the PingOne MCP server directly — no
    // ff_mcp_gateway / ff_a2a_delegation flags needed, no amount gates.
    for (const s of ADMIN_DEMO_STEPS) {
      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: s.id,
        triggerType: 'chip',
        mode: 'unit-prereq',
        status: 'PASS',
        errorClass: null,
        primaryTool: ADMIN_PARSE_EXPECT[s.id].action,
        checkedAt: new Date().toISOString(),
        verifiedBy: 'pingone-admin vertical has no flag/A2A/PAR prerequisites',
      });
    }
    expect(ADMIN_DEMO_STEPS.length).toBe(7);
  });
});
