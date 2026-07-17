// demo_api_ui/tests/e2e/repro-llm-only-hang.real.spec.js
'use strict';
/**
 * REPRO: "Routing: LLM only" + a vertical chip = timeout with no response.
 *
 * The Routing dropdown is NOT a per-request setting — it flips the GLOBAL
 * ff_heuristic_enabled flag (AIAgent.js: heuristicFallback={heuristicEnabled}).
 * With it off, the BFF's heuristic floor stops answering matched chip phrases
 * and every prompt goes to the LLM. Every prior chip test ran with the floor ON,
 * which is exactly why they were all green.
 *
 * This spec drives the two hops a chip actually makes, with the floor OFF, and
 * TIMES each one so we can see which hangs:
 *   1. POST /api/demo-agent/nl        (routing; SPA allows 60s for llamacpp)
 *   2. POST /api/agent/invoke         (execution; SPA allows 30s, hard-coded)
 *
 * Restores the flag in afterAll no matter what — it is global state on a live
 * demo stack.
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, loginAsAdmin, requireRealLoginEnv, requireAdminLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');

const VERTICAL = 'sporting-goods';
const CHIP = 'my gear';

async function timed(fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value, error: null };
  } catch (e) {
    return { ms: Date.now() - t0, value: null, error: e };
  }
}

test.describe('repro: LLM-only routing + vertical chip', () => {
  test.skip(!requireRealLoginEnv() || !requireAdminLoginEnv(), 'Requires E2E_CUSTOMER_* and E2E_ADMIN_*');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  let customerCtx; let adminCtx; let api; let adminApi;

  test.beforeAll(async ({ browser }) => {
    // ignoreHTTPSErrors: the stack serves a mkcert cert Playwright won't trust.
    customerCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    await loginAsCustomer(await customerCtx.newPage());
    api = customerCtx.request;

    adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    await loginAsAdmin(await adminCtx.newPage());
    adminApi = adminCtx.request;

    await activateVertical(api, VERTICAL);
  });

  test.afterAll(async () => {
    // ALWAYS restore — this is global state on a live demo stack.
    await adminApi?.patch('/api/admin/feature-flags', {
      data: { updates: { ff_heuristic_enabled: true } },
    }).catch(() => {});
    await activateVertical(api, 'banking').catch(() => {});
    await customerCtx?.close().catch(() => {});
    await adminCtx?.close().catch(() => {});
  });

  test('floor ON (control): the chip answers fast', async () => {
    await adminApi.patch('/api/admin/feature-flags', { data: { updates: { ff_heuristic_enabled: true } } });
    const nl = await timed(async () => {
      const r = await api.post('/api/demo-agent/nl', { data: { message: CHIP, provider: 'llamacpp', vertical: VERTICAL } });
      return r.json();
    });
    console.log(`\n[floor ON] /nl ${nl.ms}ms -> ${JSON.stringify(nl.value)}\n`);
    expect(nl.error).toBeNull();
  });

  test('floor OFF ("LLM only"): time BOTH hops to find the hang', async () => {
    const patch = await adminApi.patch('/api/admin/feature-flags', {
      data: { updates: { ff_heuristic_enabled: false } },
    });
    console.log(`[flag] set ff_heuristic_enabled=false -> ${patch.status()}`);
    expect(patch.ok(), 'admin must be able to flip the flag').toBe(true);

    // Hop 1 — routing. The SPA allows 60s here for llamacpp.
    const nl = await timed(async () => {
      const r = await api.post('/api/demo-agent/nl',
        { data: { message: CHIP, provider: 'llamacpp', vertical: VERTICAL }, timeout: 90_000 });
      return { status: r.status(), body: await r.json() };
    });
    console.log(`\n[floor OFF] HOP 1 /nl: ${nl.ms}ms`);
    console.log(`  ${nl.error ? 'ERROR ' + nl.error.message : JSON.stringify(nl.value)}\n`);

    // Hop 2 — execution, exactly as the SPA re-dispatches a vertical chip.
    // The SPA hard-codes 30s here; we allow 90s to see the TRUE duration.
    const invoke = await timed(async () => {
      const r = await api.post('/api/agent/invoke',
        { data: { prompt: CHIP, forceHeuristic: true, vertical: VERTICAL }, timeout: 90_000 });
      return { status: r.status(), body: await r.json() };
    });
    console.log(`[floor OFF] HOP 2 /agent/invoke (forceHeuristic): ${invoke.ms}ms`);
    console.log(`  ${invoke.error ? 'ERROR ' + invoke.error.message : JSON.stringify(invoke.value).slice(0, 400)}\n`);

    // The SPA's real budget for hop 2 is 30s — flag anything that would abort.
    if (invoke.ms > 30_000) {
      console.log(`  *** HOP 2 took ${invoke.ms}ms > the SPA's hard-coded 30s -> the UI aborts here ***\n`);
    }

    // Diagnostic spec: report, never mask. Both hops must at least RETURN.
    expect(nl.error, `/nl failed after ${nl.ms}ms`).toBeNull();
    expect(invoke.error, `/agent/invoke failed after ${invoke.ms}ms`).toBeNull();
  });
});
