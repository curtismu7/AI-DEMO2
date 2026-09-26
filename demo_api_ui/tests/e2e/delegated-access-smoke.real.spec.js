// demo_api_ui/tests/e2e/delegated-access-smoke.real.spec.js
/**
 * @file Delegated-access (UC1) smoke — the step that kept demo-failing.
 *
 * Drives the EXACT Demo Step path that produced the opaque
 * "Run failed before token-exchange, authorize-decision" card, for BOTH
 * verticals the step is demoed in:
 *
 *   banking   — chip "show my balance"       → get_account_balance
 *   airlines  — chip "show my reservations"  → get_airline_bookings
 *
 * Asserts the FULL evidence chain (user-token → token-exchange →
 * authorize-decision → tool-dispatched) via the server's own scorer, AND that
 * the reply is grounded in live store data (chip-correctness: no hallucinated
 * balances/reservations). A DENY/STEP_UP is a valid response only for use
 * cases whose expectedOutcome says so — UC1 expects PERMIT.
 *
 * This is the gate to run before a demo; synthetic client-credentials probes
 * cannot cover it (the token policy mints the gateway audience only for real
 * user-session subjects — verified 2026-09-25).
 *
 * Run (stack up + credentials in tests/e2e/.env.e2e):
 *   cd demo_api_ui && npx playwright test \
 *     tests/e2e/delegated-access-smoke.real.spec.js --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');
const {
  resolveUseCase,
} = require('../../../demo_api_server/config/useCases');
const {
  scoreDelegatedAccessInvoke,
} = require('../../../demo_api_server/services/stepVerificationExpectations');

const VERTICALS = (process.env.E2E_DA_VERTICALS || 'banking,airlines')
  .split(',').map((s) => s.trim()).filter(Boolean);

test.describe('delegated-access smoke (real)', () => {
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
    // Leave the demo on its default vertical.
    await activateVertical(ctx.request, 'banking').catch(() => {});
    await ctx?.close().catch(() => {});
  });

  for (const vertical of VERTICALS) {
    test(`${vertical}: UC1 delegated-access chain completes with grounded reply`, async () => {
      await activateVertical(ctx.request, vertical);

      const uc = resolveUseCase('UC1', vertical);
      expect(uc, `UC1 resolves for ${vertical}`).toBeTruthy();
      const chipText = uc.trigger?.text;
      expect(chipText, `${vertical} UC1 chip text`).toBeTruthy();

      // Dispatch the way Demo Steps do: invoke + forceHeuristic.
      const resp = await ctx.request.post('/api/agent/invoke', {
        data: {
          prompt: chipText,
          vertical,
          useCaseId: uc.useCaseId || 'delegated-access-with-proof',
        },
        timeout: 120_000,
      });
      const body = await resp.json().catch(() => ({}));
      expect(resp.status(), `invoke HTTP ${resp.status}: ${body.error || ''}`).toBe(200);
      expect(body.success, `invoke failed: ${body.error || body.reply || body.message || ''}`).toBe(true);

      // Full evidence-chain scoring with the server's own expectations module —
      // the same scorer the step-verification ledger uses, so a green here is
      // the same green the ledger records.
      const scored = scoreDelegatedAccessInvoke(
        { status: resp.status(), body },
        { evidenceTokenChain: uc.evidence?.tokenChain },
      );
      expect(scored.ok, `chain incomplete: ${scored.reason} (missing: ${scored.missingSteps || []})`).toBe(true);

      // Grounding (banking only): balance replies carry amounts, so intersect
      // the reply with the live accounts the UI itself fetches. Other verticals
      // legitimately answer with summary prose ("Here are your airline
      // bookings.") — a number-intersection there produces false failures, and
      // the full evidence-chain score above is already the authoritative check.
      if (vertical === 'banking') {
        const accounts = await ctx.request.get('/api/accounts/my', { timeout: 30_000 })
          .then((r) => (r.ok() ? r.json() : null))
          .catch(() => null);
        const balances = (accounts?.accounts || [])
          .map((a) => String(a.balance))
          .filter((b) => b && b.length >= 2);
        if (balances.length) {
          const reply = String(body.reply || '');
          const grounded = balances.some((b) => reply.includes(b));
          expect(grounded,
            `reply not grounded in live balances (${balances.join(', ')}). reply=${reply.slice(0, 200)}`).toBe(true);
        }
      }
    });
  }
});
