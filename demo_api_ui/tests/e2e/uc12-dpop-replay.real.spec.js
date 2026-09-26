// demo_api_ui/tests/e2e/uc12-dpop-replay.real.spec.js
/**
 * @file UC12 smoke — Token theft / DPoP replay defense (real stack, real session).
 *
 * The demo step runs the dpop-replay attack sim through /api/demo/attack-sim/run
 * and scores it with the server's own scoreAttackSimDeny: the expected outcome is
 * DENY (errorCode dpop_replay_blocked) over the evidence chain
 * [sim-replay-start, sim-gateway-deny].
 *
 * Found broken 2026-09-26 (PR #292 follow-up): with ff_mcp_gateway_pinggateway
 * on, the sim's token was minted for the PingGateway audience and routed to IG —
 * which has no DPoP jti replay cache — so the replay 200'd (unexpected_permit).
 * Fix: the sim now forces the NODE gateway audience + pinNodeGateway routing.
 *
 * Run: cd demo_api_ui && npx playwright test tests/e2e/uc12-dpop-replay.real.spec.js \
 *       --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { resolveUseCase } = require('../../../demo_api_server/config/useCases');
const {
  scoreAttackSimDeny,
} = require('../../../demo_api_server/services/stepVerificationExpectations');

test.describe('UC12 dpop-replay smoke (real)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ timeout: 180_000 });

  test('dpop-replay sim: replay DENIED over the declared evidence chain', async ({ browser }) => {
    const uc = resolveUseCase('UC12', 'banking');
    expect(uc, 'UC12 resolves').toBeTruthy();

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAsCustomer(page);

    const resp = await page.evaluate(async (simId) => {
      const r = await fetch('/api/demo/attack-sim/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sim: simId }),
      });
      return { status: r.status, body: await r.json() };
    }, uc.trigger?.sim || 'dpop-replay');

    const scored = scoreAttackSimDeny(resp, {
      expectedErrorCode: 'dpop_replay_blocked',
      evidenceTokenChain: uc.evidence?.tokenChain || ['sim-replay-start', 'sim-gateway-deny'],
    });

    expect(scored.ok, `UC12 step failed: ${scored.reason} (matched: ${scored.matchedSteps})`).toBe(true);
    // And the DENY reason must name the DPoP control, not a downstream error.
    expect(String(resp.body.reason || ''), 'deny reason should name the DPoP control')
      .toMatch(/DPoP|dpop/);
    await ctx.close();
  });
});
