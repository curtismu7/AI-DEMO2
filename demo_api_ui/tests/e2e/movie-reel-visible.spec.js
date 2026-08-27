// The movie reel lock.
//
// The reel has now gone missing FOUR times, and every previous fix added a
// static source guard (FocusModeFilmstripGuard.test.js) that kept passing while
// the reel was invisible on screen. That is the whole problem: "the component is
// rendered" and "a human can see it" are different claims, and only the first
// was ever tested.
//
//   #1 (PR #1784)  gated behind ba_show_filmstrip === "1", default OFF
//   #2 (PR #1896)  one stray click persisted "0" and hid it in that profile forever
//   #3 (PR #2384)  only the float branch was gated, so the switch governed a
//                  branch nobody was looking at
//   #4 (PR #2487)  rendered in float/dock mode at y~2800 of a ~3500px page
//   #5 (this file) focus mode's grid was never bounded, so on a window shorter
//                  than ~760px the chain row sat at y~1200 — below the fold on a
//                  laptop, fine on a big monitor, which is why it kept coming
//                  back as "it works for me"
//
// toBeInViewport() is the assertion that fails for every one of them.
//
// The API is mocked (same helper customer-dashboard.spec.js uses) so this runs
// in CI against a plain dev server with no stack behind it. That is the ONLY
// way to run it.
//
// Do NOT point it at the live stack with PLAYWRIGHT_BASE_URL. The mocks claim a
// signed-in customer while the real BFF answers every endpoint they do not cover
// as signed out, and the app raises its "Sign in required" modal over a
// half-mocked page — the short-window case then fails on a modal, not on the
// reel. Measured 2026-08-27: a live run reports 1 failed while the same live
// page, unmocked, has the reel at y=623 bottom=699 in a 700px viewport.
// The live guard is the reel check in scripts/canary/uc1-canary.js, which runs
// every 30 minutes against a really signed-in session and mocks nothing.
const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');

// The three layouts /dashboard can be in, read from localStorage by
// AgentUiModeContext. All three must show the reel; #3 and #4 were each a bug in
// exactly one of them, found only when someone happened to demo in that layout.
const PLACEMENTS = ['middle', 'none', 'bottom'];

/**
 * The shared helper pins ff_customer_skin_ping2026 OFF (classic dashboard, which
 * has no reel by design). Registered after it, so this handler wins — Playwright
 * matches routes newest-first — without editing a helper five other specs use.
 */
async function mockDashboardWithReel(page, placement) {
  await mockCustomerDashboard(page);
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        flags: [
          { id: 'ff_show_agent_in_middle', value: true },
          { id: 'ff_agent_clinical_split', value: false },
          { id: 'ff_customer_skin_ping2026', value: true },
        ],
      }),
    }),
  );
  if (placement) {
    await page.addInitScript((p) => {
      window.localStorage.setItem(
        'banking_agent_ui_v2',
        JSON.stringify({ placement: p, fab: true, mode: null }),
      );
    }, placement);
  }
}

for (const placement of PLACEMENTS) {
  test(`movie reel is on screen in ${placement} layout`, async ({ page }) => {
    await mockDashboardWithReel(page, placement);
    await page.goto('/dashboard');

    // The chain strip — the reel itself, not the spotlight beside it.
    const reel = page.locator('.tcfs-chain');
    await expect(reel).toBeVisible({ timeout: 15000 });

    // The assertion that matters. Present-in-DOM is not the claim being made.
    await expect(reel).toBeInViewport();
  });
}

test('the reel is on screen without scrolling on a short laptop window', async ({ page }) => {
  // 1440x700 — a 1440x900 laptop minus browser chrome and the menu bar. Focus
  // Mode's grid is overflow:hidden, so a layout that only fits on a tall window
  // loses the reel silently instead of growing a scrollbar. This is the exact
  // case that survived four previous fixes.
  await page.setViewportSize({ width: 1440, height: 700 });
  await mockDashboardWithReel(page, null);
  await page.goto('/dashboard');

  const reel = page.locator('.tcfs-chain');
  await expect(reel).toBeVisible({ timeout: 15000 });
  await expect(reel).toBeInViewport();
});
