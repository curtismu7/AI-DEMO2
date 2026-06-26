/**
 * @file verticals.live-switch.real.spec.js
 * @description End-to-end test for SSE-driven live vertical switching.
 *
 * SKIPPED automatically when E2E env vars are not set.
 *
 * Scenario:
 *   1. Customer logs in to tab A; lands on /dashboard.
 *   2. Admin logs in to tab B; navigates to /admin.
 *   3. Admin switches the active vertical from whatever it currently is to
 *      'healthcare' via POST /api/verticals/active.
 *   4. Tab A (customer) must update within 10 seconds with NO full page reload:
 *      - document.title contains the new vertical's displayName
 *      - CSS variable --theme-accent reflects the new manifest
 *      - the page did not unload and reload (location stays at /dashboard,
 *        and a sentinel injected on the page survives).
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
} = require('./helpers/realLogin');

test.describe('verticals live switch', () => {
  test.beforeAll(() => {
    test.skip(
      !requireRealLoginEnv() || !requireAdminLoginEnv(),
      'Skipped: E2E_CUSTOMER_USERNAME and E2E_ADMIN_USERNAME both required'
    );
  });

  // Use the fixture-provided browser so the trace artifact directory is set up
  // correctly — manually launched browsers (chromium.launch()) lack the artifact
  // dir and cause ENOENT when Playwright tries to save traces on failure.
  test('admin switches active vertical; customer tab updates without reload', async ({ browser }) => {
    // Separate browser contexts so each session is independent.
    const customerCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const customerPage = await customerCtx.newPage();
    const adminPage = await adminCtx.newPage();

    try {
      // 1. Log in both users.
      await loginAsCustomer(customerPage);
      await loginAsAdmin(adminPage);

      // 2. Customer lands on /dashboard. Avoid waitForLoadState('networkidle')
      //    because the active SSE connection prevents networkidle from resolving.
      //    Instead wait for the React app to render a non-empty document.title.
      await customerPage.goto('https://demo-api-server:3001/dashboard');
      await customerPage.waitForFunction(
        () => document.title && document.title.trim().length > 0,
        { timeout: 30000 }
      );

      // Inject a sentinel on window so we can detect a full reload (it would
      // be cleared on navigation).
      await customerPage.evaluate(() => { window.__VERTICAL_LIVE_SWITCH_SENTINEL__ = 'present'; });

      // Capture the starting title and accent so we can assert change.
      const startTitle = await customerPage.title();
      const startAccent = await customerPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
      );

      // 3. Admin switches to healthcare via the API. We use page.evaluate so
      //    the cookies travel automatically (no need to forge headers).
      const switchTo = startTitle.toLowerCase().includes('care')
        ? 'banking'   // already on healthcare; switch to banking instead
        : 'healthcare';
      const switchStatus = await adminPage.evaluate(async (id) => {
        const res = await fetch('/api/verticals/active', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        return res.status;
      }, switchTo);
      expect(switchStatus).toBe(204);

      // 4. Customer tab must update within 10 seconds (SSE-driven).
      await customerPage.waitForFunction(
        ({ start }) => document.title !== start,
        { start: startTitle },
        { timeout: 10000 }
      );

      // Sentinel survived → no full page reload.
      const sentinel = await customerPage.evaluate(() => window.__VERTICAL_LIVE_SWITCH_SENTINEL__);
      expect(sentinel).toBe('present');

      // Title changed.
      const newTitle = await customerPage.title();
      expect(newTitle).not.toBe(startTitle);

      // CSS variable changed (or at least, is non-empty — different verticals
      // have different accent tokens; if startAccent was empty the assertion
      // is still meaningful because we now expect something).
      const newAccent = await customerPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
      );
      expect(newAccent).not.toBe('');
      expect(newAccent).not.toBe(startAccent);
    } finally {
      await customerCtx.close().catch(() => {});
      await adminCtx.close().catch(() => {});
    }
  });

  test('switching to retail re-renders chips with retail data-chip-id attributes', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    try {
      await loginAsCustomer(page);
      await page.goto('https://demo-api-server:3001/dashboard');
      await page.waitForFunction(
        () => document.title && document.title.trim().length > 0,
        { timeout: 30000 }
      );

      // Switch to retail via the same fetch path the admin UI uses.
      const switchStatus = await page.evaluate(async () => {
        const res = await fetch('/api/verticals/active', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'retail' }),
        });
        return res.status;
      });
      expect(switchStatus).toBe(204);

      // Wait for SSE-driven re-render: at least one chip with id starting "rt"
      await page.waitForFunction(
        () => document.querySelector('[data-chip-id^="rt"]') !== null,
        { timeout: 10000 }
      );

      // Confirm several retail chips are visible
      await expect(page.locator('[data-chip-id="rt1"]')).toBeVisible();
      await expect(page.locator('[data-chip-id="rt3"]')).toBeVisible();

      // Section label should reflect the retail vertical name (not hardcoded "Suggestions")
      const labelText = await page.locator('.banking-chips-dropdown__label').first().textContent();
      expect(labelText).toMatch(/retail|great\sbuy|actions/i);

      // Click the first heuristic retail chip and expect a non-empty response
      await page.locator('[data-chip-id="rt1"]').click();
      await page.waitForSelector('.agent-message, [data-testid="agent-response"]', { timeout: 15000 });
      const responseText = await page.locator('.agent-message, [data-testid="agent-response"]').last().textContent();
      // Retail chips produce retail content, not banking-specific language
      expect(responseText).toMatch(/order|item|purchase|great\sbuy/i);
    } finally {
      // Restore banking so subsequent tests start from a known state
      await page.evaluate(async () => {
        await fetch('/api/verticals/active', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'banking' }),
        });
      }).catch(() => {});
      await ctx.close().catch(() => {});
    }
  });
});
