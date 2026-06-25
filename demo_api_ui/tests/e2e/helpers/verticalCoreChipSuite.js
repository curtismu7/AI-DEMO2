// demo_api_ui/tests/e2e/helpers/verticalCoreChipSuite.js
'use strict';
/**
 * Registers Playwright tests: core vertical chips × heuristic + Helix × full MCP pipeline.
 */
const { test, expect } = require('@playwright/test');
const { request: playwrightRequest } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
  waitForE2eBaseUrl,
} = require('./realLogin');
const {
  runVerticalMcpChip,
  activateVertical,
  assertAdminPipelineEvents,
} = require('./chipPipeline');
const { getVerticalCoreChips } = require('./verticalCoreChips');

const HELIX_PROBE_MESSAGE = 'Reply with exactly the single word: persimmon';

/**
 * @param {{ verticalId: string, suiteTitle?: string }} options
 */
function registerVerticalCoreChipTests(options) {
  const { verticalId, suiteTitle } = options;
  const chips = getVerticalCoreChips(verticalId);
  const title =
    suiteTitle ||
    `${verticalId} — core chips full MCP pipeline (heuristic + Helix)`;

  test.describe(title, () => {
    test.skip(
      !requireRealLoginEnv() || !requireAdminLoginEnv(),
      'Requires E2E_CUSTOMER_* and E2E_ADMIN_* env vars',
    );
    test.describe.configure({ mode: 'serial', timeout: 300_000 });

    let customerApi;
    let adminApi;
    let customerCtx;
    let adminCtx;
    let helixConfigured = false;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      const probeCtx = await browser.newContext({ ignoreHTTPSErrors: true });
      await waitForE2eBaseUrl(probeCtx.request);
      await probeCtx.close();

      customerCtx = await browser.newContext({ ignoreHTTPSErrors: true });
      const cPage = await customerCtx.newPage();
      await loginAsCustomer(cPage);
      customerApi = customerCtx.request;

      adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
      const aPage = await adminCtx.newPage();
      await loginAsAdmin(aPage);
      adminApi = adminCtx.request;

      await activateVertical(customerApi, verticalId);

      const probe = await customerApi.post('/api/demo-agent/nl', {
        data: { message: HELIX_PROBE_MESSAGE, provider: 'helix', vertical: verticalId },
      });
      const probeBody = probe.ok() ? await probe.json() : {};
      helixConfigured = probeBody.source === 'helix' || probeBody.source === 'helix_fallback';
    });

    test.afterAll(async () => {
      await activateVertical(customerApi, 'banking').catch(() => {});
      await customerCtx?.close().catch(() => {});
      await adminCtx?.close().catch(() => {});
    });

    for (const chip of chips) {
      test(`Heuristic — ${chip.label} (MCP ${chip.mcpTool})`, async () => {
        const { source, executed, since } = await runVerticalMcpChip(
          customerApi,
          chip,
          'heuristic',
          verticalId,
        );
        expect(source).toBe('heuristic');
        expect(executed).toBe(true);
        await assertAdminPipelineEvents(adminApi, since, `${chip.id}-heuristic`);
      });

      test(`LLM (Helix) — ${chip.label} (MCP ${chip.mcpTool})`, async () => {
        test.skip(
          !helixConfigured,
          'Helix is NOT configured — cannot validate LLM chips. Set helix_api_key via /setup or LLM2.json.',
        );

        const { source, executed, since } = await runVerticalMcpChip(
          customerApi,
          chip,
          'helix',
          verticalId,
        );
        expect(['helix', 'helix_fallback']).toContain(source);
        expect(executed).toBe(true);
        await assertAdminPipelineEvents(adminApi, since, `${chip.id}-helix`);
      });
    }
  });
}

module.exports = { registerVerticalCoreChipTests };
