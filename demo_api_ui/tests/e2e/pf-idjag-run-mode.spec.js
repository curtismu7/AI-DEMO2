const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');
const { settle } = require('./helpers/uiProbe');

const DEMO_PATH = '/pingfederate-id-jag/demo';
const UC40 = 'enterprise-managed-mcp-authorization';
const PENDING_KEY = 'bx_id_jag_pending_intent';
const REPLAYED_KEY = 'bx_id_jag_replayed';
const CALLBACK_KEY = 'bx_id_jag_validated_callback';
const RUN_CONTEXT_KEY = 'bx_run_context';

async function installHandoffBoundary(page) {
  const calls = [];
  await page.route('**/api/admin/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ config: { oauth_provider: 'pingfederate' } }),
  }));
  await page.route('**/api/auth/oauth/user/id-jag/intent', async (route) => {
    calls.push({ kind: 'intent', body: route.request().postDataJSON() });
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route((url) => url.pathname === '/api/auth/logout' && url.searchParams.get('id_jag_handoff') === '1', async (route) => {
    calls.push({ kind: 'logout', method: route.request().method() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ idJagHandoff: true, logoutUrl: '/__e2e_pf_login_boundary__' }),
    });
  });
  await page.route('**/__e2e_pf_login_boundary__', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>PingFederate login boundary</title><h1>PingFederate login boundary</h1>',
  }));
  return calls;
}

async function expectHandoff(page, calls, returnTo) {
  await expect(page).toHaveURL(/\/__e2e_pf_login_boundary__$/, { timeout: 15_000 });
  expect(calls).toEqual([
    { kind: 'intent', body: { useCaseId: UC40, mode: 'live-id-jag', message: 'show my balance', returnTo } },
    { kind: 'logout', method: 'GET' },
  ]);
}

async function seedStaleMode(page) {
  await page.evaluate(({ pending, replayed, callback, runContext }) => {
    sessionStorage.setItem(pending, JSON.stringify({ useCaseId: 'enterprise-managed-mcp-authorization', mode: 'live-id-jag' }));
    sessionStorage.setItem(replayed, '1');
    sessionStorage.setItem(callback, JSON.stringify({ mode: 'live-id-jag' }));
    sessionStorage.setItem(runContext, JSON.stringify({ useCaseId: 'enterprise-managed-mcp-authorization', mode: 'live-id-jag' }));
  }, { pending: PENDING_KEY, replayed: REPLAYED_KEY, callback: CALLBACK_KEY, runContext: RUN_CONTEXT_KEY });
}

async function expectModeCleared(page) {
  await expect.poll(() => page.evaluate((keys) => keys.map((key) => sessionStorage.getItem(key)),
    [PENDING_KEY, REPLAYED_KEY, CALLBACK_KEY, RUN_CONTEXT_KEY])).toEqual([null, null, null, null]);
}

test('opening the demo page does not start logout or an ID-JAG intent', async ({ page }) => {
  const authRequests = [];
  page.on('request', (request) => {
    if (/\/api\/auth\/(?:logout|oauth\/user\/id-jag\/intent)/.test(request.url())) authRequests.push(request.url());
  });
  await page.goto(DEMO_PATH);
  await settle(page);
  await expect(page.getByRole('button', { name: 'Run live ID-JAG demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run mock demo' })).toBeVisible();
  expect(authRequests).toEqual([]);
});

test('signed-out mock replay completes with no auth or agent dependency', async ({ page }) => {
  await page.route('**/api/auth/oauth/status', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/auth/oauth/user/status', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto(DEMO_PATH);
  await settle(page);
  const forbidden = [];
  await page.route('**/api/**', (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });

  await page.getByRole('button', { name: 'Run mock demo' }).click();
  await expect(page.getByRole('status')).toHaveText('Mock replay — no login or live tokens');
  const filmstrip = page.getByRole('region', { name: 'Token chain' });
  await expect(filmstrip.locator('[data-provenance="mock-id-jag"]')).toBeVisible();
  await expect(filmstrip.locator('[title="Mock replay — ID-JAG issued"]')).toBeVisible();
  await expect(filmstrip.locator('[title="Mock replay — ID-JAG redeemed"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${DEMO_PATH}$`));
  expect(forbidden).toEqual([]);
});

test('the live button posts the intent before the silent logout handoff', async ({ page }) => {
  const calls = await installHandoffBoundary(page);
  await page.goto(DEMO_PATH);
  await settle(page);
  await page.getByRole('button', { name: 'Run live ID-JAG demo' }).click();
  await expectHandoff(page, calls, DEMO_PATH);
});

test('Mission Control UC40 uses the same live handoff', async ({ page }) => {
  await mockCustomerDashboard(page);
  await page.route('**/api/use-cases**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ useCases: [{
      id: 'UC40', useCaseId: UC40, title: 'Enterprise-Managed MCP Authorization',
      trigger: { type: 'chip', text: 'show my balance' },
    }] }),
  }));
  const calls = await installHandoffBoundary(page);
  await page.goto('/dashboard');
  await settle(page);
  // A modal backdrop (the agent window opening) can cover the header for the first seconds.
  await expect(page.locator('.dm-backdrop')).toHaveCount(0, { timeout: 15_000 });
  // On /dashboard the dock owns the controls (split chrome), so "Demo steps" is the header button beside
  // Favorites (TopNav), which opens the same Demo Steps panel; the dock itself has no Demo steps button.
  // Open it first: the Demo Controls dock, once open, sits over that header button.
  const stepsTrigger = page.getByTestId('topnav-demo-steps-trigger');
  await expect(stepsTrigger).toBeVisible();
  await stepsTrigger.click();
  await expect(page.getByTestId('demo-steps-popout').first()).toBeVisible();
  await page.getByRole('button', { name: '🎛 Demo Controls', exact: true }).click();
  await expect(page.locator('.cmd-dock-panel')).toBeVisible();
  const chip = page.getByTestId('demo-step-UC40');
  await expect(chip).toContainText('Signs out your current session silently');
  // The Demo Steps panel is a non-modal floating window portaled to <body> (the modal scrim was removed on
  // 2026-09-28; unit-tested in DemoStepsDropdown.test.jsx). It and the Demo Controls dock are separate
  // draggable windows at one z-index, and at 1280px the dock overlaps the right of the panel, so the chip's
  // centre can be under it. What must hold: no scrim, and the chip's left edge is not covered.
  await chip.scrollIntoViewIfNeeded();
  const layerOrder = await page.evaluate(() => {
    const drawer = document.querySelector('[data-testid="demo-steps-popout"]');
    const chipEl = document.querySelector('[data-testid="demo-step-UC40"]');
    if (!drawer || !chipEl) return { drawer: Boolean(drawer), chip: Boolean(chipEl) };
    const rect = chipEl.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + 24, rect.top + 24);
    return {
      scrimCount: document.querySelectorAll('[data-testid="demo-steps-scrim"]').length,
      drawerInBody: drawer.parentElement === document.body,
      dockOpen: Boolean(document.querySelector('.cmd-dock-panel')),
      chipEdgeIsTopmost: Boolean(topmost && chipEl.contains(topmost)),
    };
  });
  expect(layerOrder).toEqual({
    scrimCount: 0,
    drawerInBody: true,
    dockOpen: true,
    chipEdgeIsTopmost: true,
  });
  await chip.click({ position: { x: 24, y: 24 } });
  await expectHandoff(page, calls, '/dashboard');
});

test('the authenticated app shell handles the shared live handoff event', async ({ page }) => {
  const calls = await installHandoffBoundary(page);
  await page.goto(DEMO_PATH);
  await expect(page.getByRole('button', { name: 'Run mock demo' })).toBeVisible();
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('id-jag-run-requested', { detail })), {
    useCaseId: UC40, mode: 'live-id-jag', message: 'show my balance', returnTo: '/dashboard',
  });
  await expectHandoff(page, calls, '/dashboard');
});

for (const provider of ['pingone', 'pingfederate']) {
  test(`ordinary ${provider} login clears stale ID-JAG mode`, async ({ page }) => {
    await page.goto(DEMO_PATH);
    await expect(page.getByRole('button', { name: 'Run mock demo' })).toBeVisible();
    await seedStaleMode(page);
    await page.evaluate((oauthProvider) => window.dispatchEvent(new CustomEvent('userAuthenticated', {
      detail: { user: { id: 'demo-user', username: 'demoUser', role: 'customer' }, oauthProvider },
    })), provider);
    await expectModeCleared(page);
  });
}

test('switching provider clears ID-JAG mode before leaving the page', async ({ page }) => {
  await mockCustomerDashboard(page);
  const configPosts = [];
  await page.route('**/api/auth/clear-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/api/admin/config', (route) => {
    if (route.request().method() === 'POST') {
      configPosts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { config: { oauth_provider: 'pingone' } } });
  });
  await page.route('**/logout', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Logout boundary</title>',
  }));
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '🎛 Demo Controls', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Toggle OAuth login provider' });
  await expect(toggle).toBeVisible();
  await seedStaleMode(page);
  await page.keyboard.press('Escape');
  const dashboardReload = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await toggle.evaluate((element) => element.click());
  await expect.poll(() => configPosts.length).toBe(1);
  // The toggle's contract (OAuthProviderToggle.jsx): POST config, clear the
  // BFF session, then window.location.reload() — the browser stays on the
  // same URL rather than navigating to /logout. The reload re-runs the
  // dashboard boot; wait for it, then assert mode cleared.
  await dashboardReload;
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(configPosts).toEqual([{ oauth_provider: 'pingfederate' }]);
  await expectModeCleared(page);
});
