// demo_api_ui/tests/e2e/uc2-a2a-delegation.real.spec.js
//
// UC2 smoke (real): the A2A delegation chain must complete end-to-end through
// the REAL stack — real PingOne login, real RFC 8693 nested-act exchange chain
// (agent1 actor → exchange1 → wire bearer → agent2 actor → exchange2), and a
// real specialist tool call that returns data.
//
// This spec is the regression gate for the 2026-09-26 incident where UC2
// failed with a generic `a2a_unauthorized` for ~40 minutes because:
//   1. The demo user's PingOne a2aTenantId attribute was missing (bearer gate).
//   2. The A2A gateway resource's audience drifted to its NAME, so exchange2
//      tokens carried aud="Super Banking A2A MCP Gateway" and every gateway
//      rejected them (wrong-aud).
//   3. The BFF kept routing the nested-act token to PingGateway (IG), whose
//      McpProtectionFilter demands its own resource URI.
// The health gate (`npm run demo:health-gate`, rows a2a:*) covers 1–3
// statically; this spec proves the full chain actually EXECUTES.
//
// Run (stack up + credentials in tests/e2e/.env.e2e):
//   cd demo_api_ui && npx playwright test \
//     tests/e2e/uc2-a2a-delegation.real.spec.js --config=playwright.real.config.js
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');
const { resolveUseCase } = require('../../../demo_api_server/config/useCases');
const {
  scoreA2aDelegationInvoke,
} = require('../../../demo_api_server/services/stepVerificationExpectations');

test.describe('UC2 a2a-delegation smoke (real)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAsCustomer(page);
    await page.close();
  });

  test.afterAll(async () => {
    await activateVertical(ctx.request, 'banking').catch(() => {});
    await ctx?.close().catch(() => {});
  });

  test('airlines: UC2 a2a-delegation chain completes with grounded reply', async () => {
    await activateVertical(ctx.request, 'airlines');

    const uc = resolveUseCase('UC2', 'airlines');
    expect(uc, 'UC2 resolves for airlines').toBeTruthy();
    const chipText = uc.trigger?.text;
    expect(chipText, 'airlines UC2 chip text').toBeTruthy();

    const resp = await ctx.request.post('/api/agent/invoke', {
      data: {
        prompt: chipText,
        vertical: 'airlines',
        useCaseId: uc.useCaseId || 'a2a-delegation',
        forceHeuristic: true,
      },
      timeout: 120_000,
    });
    const body = await resp.json().catch(() => ({}));
    expect(resp.status(), `invoke HTTP ${resp.status}: ${body.error || ''}`).toBe(200);
    expect(body.success, `invoke failed: ${body.error || body.reply || body.message || ''}`).toBe(true);

    // Full evidence-chain check: every UC2 evidence id must appear in the
    // invoke's tokenEvents (or toolsCalled for the final dispatch). The same
    // chain the step-verification ledger records.
    const chain = (uc.evidence && uc.evidence.tokenChain) || [
      'user-token', 'a2a-agent1-actor', 'a2a-exchange1',
      'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched',
    ];
    const tokenEvents = Array.isArray(body.tokenEvents) ? body.tokenEvents : [];
    const seenIds = new Set(tokenEvents.map((e) => e && e.id).filter(Boolean));
    const toolsCalled = Array.isArray(body.toolsCalled) ? body.toolsCalled : [];
    const missing = chain.filter((step) =>
      !seenIds.has(step) && !(step === 'tool-dispatched' && toolsCalled.length > 0));
    expect(missing, `evidence chain incomplete — missing: ${missing.join(',')}; got: ${[...seenIds].join(',') || '(none)'}`).toEqual([]);

    // The reply must be a completed delegation, not a classified failure.
    expect(String(body.reply || ''), 'reply should announce delegation success')
      .toMatch(/Delegation complete/i);
    expect(String(body.reply || ''), 'reply must not carry a failure classification')
      .not.toMatch(/mcp_error|gateway_policy_denied|a2a_unauthorized/i);
  });
});
