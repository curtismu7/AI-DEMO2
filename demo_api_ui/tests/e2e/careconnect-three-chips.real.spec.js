// demo_api_ui/tests/e2e/careconnect-three-chips.real.spec.js
'use strict';
/**
 * CareConnect (healthcare) — 3-chip full-path e2e:
 *   1. Heuristic  — "Check coverage" (in-process vertical tool)
 *   2. Helix      — "Which providers are in-network?" (LLM routing)
 *   3. API/MCP    — "show health record" (api-key path, analog to banking mortgage)
 *
 * Requires: ./run.sh up, E2E_CUSTOMER_* + E2E_ADMIN_* in tests/e2e/.env.e2e
 */
const { test, expect } = require('@playwright/test');
const { request: playwrightRequest } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
  waitForE2eBaseUrl,
} = require('./helpers/realLogin');
const {
  runChip,
  runVerticalHeuristicChip,
  runHelixRoutingChip,
  activateVertical,
  assertAdminPipelineEvents,
  CARECONNECT_CHIPS,
} = require('./helpers/chipPipeline');

const VERTICAL = 'healthcare';
const HELIX_PROBE_MESSAGE = 'Reply with exactly the single word: persimmon';

test.describe('CareConnect — three chips (real)', () => {
  test.skip(!requireRealLoginEnv() || !requireAdminLoginEnv(),
    'Requires E2E_CUSTOMER_* and E2E_ADMIN_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let customerApi;
  let adminApi;
  let customerCtx;
  let adminCtx;
  let helixConfigured = false;

  test.beforeAll(async ({ browser }) => {
    const probeCtx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    await waitForE2eBaseUrl(probeCtx);
    await probeCtx.dispose();

    customerCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const cPage = await customerCtx.newPage();
    await loginAsCustomer(cPage);
    customerApi = customerCtx.request;

    adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const aPage = await adminCtx.newPage();
    await loginAsAdmin(aPage);
    adminApi = adminCtx.request;

    await activateVertical(customerApi, VERTICAL);

    const probe = await customerApi.post('/api/demo-agent/nl', {
      data: { message: HELIX_PROBE_MESSAGE, provider: 'helix', vertical: VERTICAL },
    });
    const probeBody = probe.ok() ? await probe.json() : {};
    helixConfigured = probeBody.source === 'helix' || probeBody.source === 'helix_fallback';
  });

  test.afterAll(async () => {
    // Admin restore also resets the process-global default (end-user POST is session-only).
    await activateVertical(adminApi, 'banking').catch(() => {});
    await activateVertical(customerApi, 'banking').catch(() => {});
    await customerCtx?.close().catch(() => {});
    await adminCtx?.close().catch(() => {});
  });

  test('Chip 1 — Heuristic: Check coverage (in-process vertical)', async () => {
    const chip = CARECONNECT_CHIPS.heuristic;
    const { source, executed } = await runVerticalHeuristicChip(customerApi, chip, VERTICAL);
    expect(source).toBe('heuristic');
    expect(executed).toBe(true);
    // In-process vertical tools do not traverse MCP gateway / token exchange (by design).
  });

  test('Chip 2 — Helix: Which providers are in-network?', async () => {
    test.skip(
      !helixConfigured,
      'Helix is NOT configured — cannot validate CareConnect Helix chip. Set helix_api_key via /setup or LLM2.json.',
    );

    const chip = CARECONNECT_CHIPS.helix;
    const { source } = await runHelixRoutingChip(customerApi, chip, VERTICAL);
    expect(['helix', 'helix_fallback']).toContain(source);
  });

  test('Chip 3 — API/MCP: Show health record (full pipeline, like banking mortgage)', async () => {
    const chip = CARECONNECT_CHIPS.apiMcp;
    const since = new Date(Date.now() - 5000).toISOString();
    const { source, executed } = await runChip(customerApi, chip, 'heuristic', {
      vertical: VERTICAL,
      mcpTool: chip.mcpTool,
    });
    expect(source, `${chip.id} routes via heuristic`).toBe('heuristic');
    expect(executed, `${chip.id} drove MCP api-key pipeline`).toBe(true);
    await assertAdminPipelineEvents(adminApi, since, chip.id);
  });
});
