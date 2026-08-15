// demo_api_ui/tests/e2e/luw-workbench.real.spec.js
'use strict';
/**
 * LUW workbench — real browser spec (Task 8: header hoist, drawer, proof
 * header, honest verdict, and Token Chain rail focus state).
 *
 * Unit tests mock the DOM/CSS layout entirely — they cannot tell you the
 * drawer actually slides off-canvas, that the agent truly does not resize
 * when it opens, or that the rail's focus state grows the rail without
 * hiding any of the detail it shows. This spec drives the real
 * /use-cases/live page against the running stack to prove those things.
 *
 * Sign-in only works on the local.ping-devops.com host (passkey rp.id /
 * OAuth callback), so PLAYWRIGHT_BASE_URL must point there, never at
 * api.ping.demo, for the page under test.
 *
 * Viewport is fixed at 1600x1000: LiveUseCaseWorkbenchPage.css stops the
 * rail from growing in the focus state below 1200px, and makes the drawer
 * static (no off-canvas transform) below 860px — both responsive
 * behaviors that would make the assertions below meaningless.
 *
 * Run: stack up + E2E_CUSTOMER_* env (auto-skips otherwise):
 *   PLAYWRIGHT_BASE_URL=https://local.ping-devops.com:4443 \
 *   npx playwright test tests/e2e/luw-workbench.real.spec.js \
 *     --config=playwright.real.config.js --reporter=list
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

test.describe('LUW workbench — real browser (header hoist + drawer + verdict + rail)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let ctx;
  let page;
  let catalog;
  const restoreFlags = {};

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
    });
    page = await ctx.newPage();
    await loginAsCustomer(page);
    // loginAsCustomer's OAuth callback lands on the app's callback port, not
    // necessarily this worktree's port — navigate back to the page under test.
    await page.goto('/use-cases/live');
    await page.waitForSelector('.luw-topbar__agent-tools', { timeout: 30_000 });

    // This deployment has no live PingOne Authorize decision endpoint
    // configured — pin the simulated engine so an authorize-decision can
    // land at all, exactly as use-cases-agent.real.spec.js does for the
    // same reason. Restored in afterAll.
    const flagsResp = await ctx.request.get('/api/admin/feature-flags');
    if (flagsResp.ok()) {
      const flags = (await flagsResp.json())?.flags || [];
      const f = flags.find((x) => x.id === 'ff_authorize_real');
      const current = f && (f.value === true || f.value === 'true');
      if (f && current !== false) {
        restoreFlags.ff_authorize_real = current;
        const patch = await ctx.request.patch('/api/admin/feature-flags', {
          data: { updates: { ff_authorize_real: false } },
        });
        expect(patch.ok(), 'ff_authorize_real pinned false').toBe(true);
      }
    }

    const catalogResp = await ctx.request.get('/api/use-cases?vertical=banking');
    expect(catalogResp.status(), 'use-case catalog fetch').toBe(200);
    catalog = (await catalogResp.json()).useCases || [];
  });

  test.afterAll(async () => {
    if (Object.keys(restoreFlags).length) {
      await ctx.request
        .patch('/api/admin/feature-flags', { data: { updates: restoreFlags } })
        .catch(() => {});
    }
    await page?.close().catch(() => {});
    await ctx?.close().catch(() => {});
  });

  /**
   * Locates a use-case's drawer card by exact id. UC1 is a string prefix of
   * UC10-UC19, so the id must be anchored to a word boundary. UC1/UC6 also
   * each render twice (once in the 15-Min Security group, once in the
   * ungrouped primary list) — `.first()` picks a deterministic instance.
   */
  function ucCard(id) {
    return page.locator('.luw-card').filter({
      has: page.locator('.luw-card__meta', { hasText: new RegExp(`^${id}\\b`) }),
    }).first();
  }

  async function isDrawerClosed() {
    const cls = (await page.locator('.luw-body').getAttribute('class')) || '';
    return cls.includes('luw-body--drawer-closed');
  }

  async function openDrawer() {
    if (await isDrawerClosed()) {
      await page.locator('.luw-drawer-tab').click();
      await expect(page.locator('.luw-body')).not.toHaveClass(/luw-body--drawer-closed/);
    }
  }

  async function closeDrawerIfOpen() {
    if (!(await isDrawerClosed())) {
      await page.locator('.luw-drawer__toggle').click();
      await expect(page.locator('.luw-body')).toHaveClass(/luw-body--drawer-closed/);
    }
  }

  /** Opens the drawer, clicks a use case's "Run"/"Open" button, closes the drawer. */
  async function runUseCase(id) {
    await openDrawer();
    const card = ucCard(id);
    await expect(card).toBeVisible();
    await card.locator('.luw-card__run').click();
    await closeDrawerIfOpen();
  }

  test('1. toolbar controls are hoisted into .luw-topbar__agent-tools; .ba-header keeps only the title', async () => {
    const tools = page.locator('.luw-topbar__agent-tools');
    await expect(tools).toBeVisible();

    const controls = [
      tools.locator('[aria-label="Heuristic routing"]'), // Routing select
      tools.locator('[aria-label="External wiring"]'),   // Wiring select
      tools.getByRole('checkbox', { name: 'RFC info' }),
      tools.getByRole('checkbox', { name: 'Compliance' }),
      tools.getByRole('checkbox', { name: 'Token Chain' }),
      tools.getByRole('button', { name: 'Guide' }),
      tools.getByTestId('demo-steps-trigger'),
      tools.locator('.scope-picker__opt', { hasText: 'Read' }),
      tools.getByTestId('header-clear-progress'),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
    }

    // The portal physically removes the whole control row from .ba-header's
    // own DOM subtree — assert it is gone from there, not merely duplicated.
    await expect(page.locator('.ba-header [aria-label="Heuristic routing"]')).toHaveCount(0);

    // .ba-header keeps only the status dot + title/subtitle.
    await expect(page.locator('.ba-header .ba-status-dot')).toBeVisible();
    await expect(page.locator('.ba-header .ba-title')).toBeVisible();
  });

  test('2. Demo Script drawer slides off-canvas, reopens, persists across reload, and Escape closes it', async () => {
    await openDrawer();
    const bodyBox = await page.locator('.luw-body').boundingBox();
    const drawerBoxOpen = await page.locator('.luw-drawer').boundingBox();

    await page.locator('.luw-drawer__toggle').click();
    await expect(page.locator('.luw-body')).toHaveClass(/luw-body--drawer-closed/);
    await expect(page.locator('.luw-drawer-tab')).toBeVisible();

    // Off-canvas: fully to the left of the page's own content area, not
    // merely a class flip. Compared against .luw-body's own left edge
    // (rather than raw viewport x=0) because this deployment's site-wide
    // admin-skin nav shifts the whole app to the right of the browser edge.
    const drawerBoxClosed = await page.locator('.luw-drawer').boundingBox();
    expect(drawerBoxClosed.x).toBeLessThan(drawerBoxOpen.x);
    expect(drawerBoxClosed.x + drawerBoxClosed.width).toBeLessThanOrEqual(bodyBox.x + 1);

    // Reopen from the edge tab.
    await page.locator('.luw-drawer-tab').click();
    await expect(page.locator('.luw-body')).not.toHaveClass(/luw-body--drawer-closed/);

    // Reload — closed state persists.
    await page.locator('.luw-drawer__toggle').click();
    await expect(page.locator('.luw-body')).toHaveClass(/luw-body--drawer-closed/);
    await page.reload();
    await page.waitForSelector('.luw-body', { timeout: 30_000 });
    await expect(page.locator('.luw-body')).toHaveClass(/luw-body--drawer-closed/);

    // Reopen, then Escape closes it (same as the scrim click).
    await page.locator('.luw-drawer-tab').click();
    await expect(page.locator('.luw-body')).not.toHaveClass(/luw-body--drawer-closed/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.luw-body')).toHaveClass(/luw-body--drawer-closed/);
  });

  test('3. Agent host does not resize when the drawer opens', async () => {
    await closeDrawerIfOpen();
    const before = await page.locator('.luw-agent-host').boundingBox();

    await page.locator('.luw-drawer-tab').click();
    await expect(page.locator('.luw-body')).not.toHaveClass(/luw-body--drawer-closed/);
    const after = await page.locator('.luw-agent-host').boundingBox();

    await closeDrawerIfOpen();

    expect(after.x, 'agent host x position must not change when the drawer opens').toBe(before.x);
    expect(after.width, 'agent host width must not change when the drawer opens').toBe(before.width);
  });

  test('4. Proof header populates on selection from real catalog data', async () => {
    await openDrawer();
    await ucCard('UC1').click();
    await closeDrawerIfOpen();

    const uc1 = catalog.find((u) => u.id === 'UC1');
    expect(uc1, 'UC1 present in catalog').toBeTruthy();

    await expect(page.locator('.ucph__id')).toHaveText('UC1');
    await expect(page.locator('.ucph__claim')).toHaveText(uc1.buyerStory);
    await expect(page.locator('.ucph__say')).toContainText(uc1.whatToSay);
  });

  test('5. UC1 run — Expected/Actual verdict matches PERMIT', async () => {
    await runUseCase('UC1');
    await expect(page.getByTestId('verdict-expected')).toHaveText('PERMIT');
    await expect(page.getByTestId('verdict-actual')).toHaveText('PERMIT', { timeout: 45_000 });
    await expect(page.getByTestId('verdict-match')).toContainText('matched');
  });

  test('6. UC6 run — Expected/Actual verdict matches DENY (a deliberate pass, not a failure)', async () => {
    await runUseCase('UC6');
    await expect(page.getByTestId('verdict-expected')).toHaveText('DENY');
    await expect(page.getByTestId('verdict-actual')).toHaveText('DENY', { timeout: 45_000 });
    await expect(page.getByTestId('verdict-match')).toContainText('matched');
  });

  test('7. Token chain rail grows in the focus state without losing any of its detail', async () => {
    // Reset to a genuine pre-run baseline: clear the chat AND the token
    // chain trace (the "Clear" button — tooltip: "ready for next demo run").
    const startOverBtn = page.getByRole('button', { name: 'Start Over' });
    if (await startOverBtn.count()) await startOverBtn.click();
    const clearRailBtn = page.locator('.tctr-clear-btn');
    if (await clearRailBtn.isEnabled().catch(() => false)) await clearRailBtn.click();
    await expect(page.locator('.luw-run-layout--rail-focus')).toHaveCount(0);
    const before = await page.locator('.luw-rail-host').boundingBox();

    await runUseCase('UC1');
    await expect(page.locator('.luw-run-layout--rail-focus')).toBeVisible({ timeout: 45_000 });
    const after = await page.locator('.luw-rail-host').boundingBox();
    expect(after.width, 'rail must be WIDER after a run, not merely re-classed').toBeGreaterThan(before.width);

    // Growing the rail must never cost it any of its own detail.
    await expect(page.getByRole('tab', { name: 'Token Chain' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^MCP/ })).toBeVisible();
    await expect(page.locator('.tctr-step').first()).toBeVisible();
    await expect(page.getByText('Exchange Mode Details')).toBeVisible();

    // The decisive hop the page auto-scrolls to and pulses. Production
    // selector confirmed against LiveUseCaseWorkbenchPage.js's own scroll
    // query and TraceStepCard.stepId.test.jsx's regression test — buildTraceSteps.js
    // emits makeStep("authorize", ...) for this hop; "authorize-decision" is
    // a *token-event* id used elsewhere (ProofOfEnforcementContext,
    // TokenChainDisplay), not this rail's step id.
    await expect(page.locator('[data-step-id="authorize"]')).toBeInViewport();
  });
});
