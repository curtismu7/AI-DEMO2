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
// against a really signed-in session and mocks nothing. Its cron says */30 but
// GitHub throttles scheduled workflows hard — observed gaps are 2-10 hours, so
// treat it as "a few times a day", not a 30-minute heartbeat.
const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');

// The three layouts /dashboard can be in, read from localStorage by
// AgentUiModeContext. All three must show the reel; #3 and #4 were each a bug in
// exactly one of them, found only when someone happened to demo in that layout.
// 'bottom' is not here because the dock layout is gone — AgentUiModeContext
// coerces a persisted 'bottom' to 'middle', which the last case below proves.
const PLACEMENTS = ['middle', 'none'];

/**
 * The shared helper pins ff_customer_skin_ping2026 OFF (classic dashboard, which
 * has no reel by design). Registered after it, so this handler wins — Playwright
 * matches routes newest-first — without editing a helper five other specs use.
 */
async function mockDashboardWithReel(page, placement, { clinicalSplit = false } = {}) {
  await mockCustomerDashboard(page);
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        flags: [
          { id: 'ff_show_agent_in_middle', value: true },
          { id: 'ff_agent_clinical_split', value: clinicalSplit },
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

test('movie reel is on screen in the clinical-split layout', async ({ page }) => {
  // Clinical split is an EARLY RETURN in UserDashboardPing2026 — it never reaches
  // the two reel renders further down, so it was the one customer surface with no
  // reel at all. Its own case here because no placement value routes into it:
  // the flag does, and the placement loop above pins the flag OFF.
  await mockDashboardWithReel(page, null, { clinicalSplit: true });
  await page.goto('/dashboard');

  // Prove we are actually in the clinical layout — otherwise a flag-plumbing
  // regression would silently retest the float layout and pass.
  await expect(page.locator('.user-dashboard--clinical-split')).toBeVisible({ timeout: 15000 });

  const reel = page.locator('.tcfs-chain');
  await expect(reel).toBeVisible({ timeout: 15000 });
  await expect(reel).toBeInViewport();
});

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


// The reel is not only on /dashboard. These surfaces mount the same component
// and had no viewport coverage at all — the exact gap that let #4 and #5 ship.
// /transaction-trace is the only one needing a session; the other two are public
// by design (see auth-requirements.json).
//
// /autonomous-agents is deliberately NOT here: its reel renders only inside an
// opened run that captured token events, so covering it means seeding a run
// first. Conditional-by-design is a different thing from off-screen, and a test
// that seeds state to reach it would not have caught any of the five bugs.
//
// `scrollTo` marks a page where the reel is a section of a normal scrolling
// document rather than part of a fixed app surface. There, scrolling to reach it
// is the design, so the assertion is "reachable and then actually in the
// viewport" — which still fails if the reel is clipped, zero-height or absent,
// but does not demand it be above the fold. /dashboard and /transaction-trace
// keep the strict no-scroll form: both pin the reel deliberately, so needing a
// scroll there IS the bug.
const SURFACES = [
  { path: '/transaction-trace', name: 'Transaction Trace' },
  { path: '/demo/enterprise-mcp', name: 'the Enterprise MCP demo', scrollTo: true },
  { path: '/personal-agent', name: 'Personal Agent Studio' },
];

for (const surface of SURFACES) {
  test(`movie reel is on screen on ${surface.name}`, async ({ page }) => {
    await mockDashboardWithReel(page, null);
    await page.goto(surface.path);

    const reel = page.locator('.tcfs-chain');
    await expect(reel).toBeVisible({ timeout: 15000 });
    if (surface.scrollTo) await reel.scrollIntoViewIfNeeded();
    await expect(reel).toBeInViewport();
  });
}


// The collapse toggle on the pinned dock. The reel is 40vh of a float-mode
// dashboard whose point is an unobstructed view, so it can be put away — but
// putting it away must NOT survive a reload. A persisted "hidden" is how the
// reel vanished for an entire browser profile in #1896, invisible to everyone
// else and with no self-heal, so the reload half of this test is the real
// assertion.
test('the pinned reel collapses, comes back, and does not persist collapsed', async ({ page }) => {
  await mockDashboardWithReel(page, 'none');
  await page.goto('/dashboard');

  const reel = page.locator('.tcfs-chain');
  await expect(reel).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /collapse token chain/i }).click();
  await expect(reel).toBeHidden();

  await page.getByRole('button', { name: /show token chain/i }).click();
  await expect(reel).toBeVisible();

  // Collapse again, then reload: the reel must be back.
  await page.getByRole('button', { name: /collapse token chain/i }).click();
  await expect(reel).toBeHidden();
  await page.reload();
  await expect(reel).toBeVisible({ timeout: 15000 });
  await expect(reel).toBeInViewport();
});

// A browser that persisted the retired dock layout must not end up in a branch
// nobody maintains — it lands in Focus Mode, reel and all.
test('a persisted bottom-dock placement coerces to Focus Mode', async ({ page }) => {
  await mockDashboardWithReel(page, 'bottom');
  await page.goto('/dashboard');

  await expect(page.locator('.user-dashboard--split3')).toBeVisible({ timeout: 15000 });
  const reel = page.locator('.tcfs-chain');
  await expect(reel).toBeVisible();
  await expect(reel).toBeInViewport();
});
