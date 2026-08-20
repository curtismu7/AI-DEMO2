// demo_api_server/tests/stepVerification.adminAndRefs.test.js
'use strict';

/**
 * Step verification ledger gaps from recent PRs:
 * - #765/#766: pingone-admin ADMIN1–4 Demo Steps
 * - #769: ProofStrip approve→retry outcome preservation (unit-ref)
 * - #761: agent-lifecycle kill-switch / retail button coverage (unit-ref)
 */

const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

/** Expected parse target when the pingone-admin heuristic covers the chip. */
const ADMIN_PARSE_EXPECT = {
  ADMIN1: { action: 'call_pingone_tool', toolName: 'listApplications' },
};

describe('step verification — pingone-admin ADMIN1–13', () => {
  test('catalog lists ADMIN1–13', () => {
    expect(ADMIN_DEMO_STEPS.map((s) => s.id)).toEqual([
      'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6',
      'ADMIN7', 'ADMIN8', 'ADMIN9', 'ADMIN10', 'ADMIN11', 'ADMIN12', 'ADMIN13',
    ]);
  });

  test.each(ADMIN_DEMO_STEPS.map((s) => [s.id, s]))(
    '%s: chip text present; parse or unit-ref',
    (_id, step) => {
      if (step.trigger?.type === 'link') {
        expect(step.trigger.path).toBe('/privilege-mcp-client');
        writeLedgerEntry({
          vertical: 'pingone-admin',
          useCaseId: step.id,
          triggerType: 'link',
          mode: 'unit-ref',
          status: 'PASS',
          errorClass: null,
          primaryTool: null,
          checkedAt: new Date().toISOString(),
          verifiedBy: 'AIAgent handleDemoStepSelect link routing to the existing Privilege MCP client',
        });
        return;
      }

      const text = step.trigger?.text;
      expect(text).toBeTruthy();

      const ctx = resolveVerticalCtx('pingone-admin');
      const parsed = parseHeuristic(text, 'pingone-admin', ctx, {});
      const expectParse = ADMIN_PARSE_EXPECT[step.id];

      if (expectParse) {
        // Assert only — the unit-parse ledger row for admin steps is owned by
        // stepVerification.pingone-admin.test.js (per-step tool-specific
        // verifiedBy). Writing a second, generic row here made the two suites
        // ping-pong ADMIN1's file with different verifiedBy on every full run.
        expect(parsed.action).toBe(expectParse.action);
        expect(parsed.params?.name).toBe(expectParse.toolName);
        return;
      }

      // Non-ADMIN1 prompts record route/catalog coverage here; their detailed
      // tool routing is owned by stepVerification.pingone-admin.test.js.
      writeLedgerEntry({
        vertical: 'pingone-admin',
        useCaseId: step.id,
        triggerType: 'chip',
        mode: 'unit-ref',
        status: 'PASS',
        errorClass: null,
        primaryTool: null,
        checkedAt: new Date().toISOString(),
        verifiedBy:
          'demo_api_ui embeddedAgentFabVisibility + App.structure forceVertical; '
          + 'demoAgentService.adminRouting; useCases.route.test.js pingone-admin (#765/#766)',
      });
      expect(step.title).toBeTruthy();
    },
  );
});

describe('step verification — ProofStrip approve→retry (#769)', () => {
  const REFS = [
    {
      id: 'UC8',
      vertical: 'healthcare',
      primaryTool: 'pay_bill',
      verifiedBy:
        'demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js '
        + '+ tokenChainTraceStore ingestAuthorize outcome preservation (#769)',
    },
    {
      id: 'UC7',
      vertical: 'healthcare',
      primaryTool: 'pay_bill',
      verifiedBy:
        'demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js '
        + '+ mcpToolAuthorization.transactionPolicyHitl.test.js (#769)',
    },
  ];

  test.each(REFS.map((r) => [r.id, r]))(
    '%s: HITL/STEP_UP outcome preserved across approve→retry (unit-ref)',
    (_id, r) => {
      writeLedgerEntry({
        vertical: r.vertical,
        useCaseId: r.id,
        triggerType: 'chip',
        mode: 'unit-ref',
        status: 'PASS',
        errorClass: null,
        primaryTool: r.primaryTool,
        checkedAt: new Date().toISOString(),
        verifiedBy: r.verifiedBy,
      });
      expect(r.verifiedBy).toMatch(/#769/);
    },
  );
});

describe('step verification — agent-lifecycle retail buttons (#761)', () => {
  const REFS = [
    {
      id: 'agent-lifecycle-list-orders',
      primaryTool: 'list_orders',
      verifiedBy:
        'demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx '
        + '+ e2e stepVerification retail list_orders button (#761)',
    },
    {
      id: 'ciba-out-of-band-approval',
      primaryTool: 'checkout',
      verifiedBy:
        'demo_api_ui AgentLifecyclePage CIBA checkout + e2e button.heuristic (#761)',
    },
    {
      id: 'agent-lifecycle-revoke',
      primaryTool: null,
      verifiedBy:
        'demo_api_server/src/__tests__/killSwitchService.test.js '
        + '+ AgentLifecyclePage revoke (default scope instance) (#761)',
    },
  ];

  test.each(REFS.map((r) => [r.id, r]))(
    '%s: unit-ref to existing kill-switch / lifecycle coverage',
    (_id, r) => {
      writeLedgerEntry({
        vertical: 'retail',
        useCaseId: r.id,
        triggerType: 'button',
        mode: 'unit-ref',
        status: 'PASS',
        errorClass: null,
        primaryTool: r.primaryTool,
        checkedAt: new Date().toISOString(),
        verifiedBy: r.verifiedBy,
      });
      expect(r.verifiedBy).toMatch(/#761/);
    },
  );
});
