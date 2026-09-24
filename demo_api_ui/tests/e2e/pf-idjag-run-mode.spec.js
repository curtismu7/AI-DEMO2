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
  await expect(page.getByTestId('demo-steps-trigger').first()).toBeVisible();
  await page.getByTestId('demo-steps-trigger').first().click();
  const chip = page.getByTestId('demo-step-UC40');
  await expect(chip).toContainText('Signs out your current session silently');
  await chip.click();
  await expectHandoff(page, calls, '/dashboard');
});

test('the UC40 agent phrase uses the same live handoff', async ({ page }) => {
  await mockCustomerDashboard(page);
  const calls = await installHandoffBoundary(page);
  await page.goto('/dashboard');
  const input = page.getByPlaceholder(/^Message |^Ask about/).first();
  await expect(input).toBeVisible();
  await page.evaluate((useCaseId) => window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
    detail: { useCaseId, message: 'run ID-JAG demo' },
  })), UC40);
  await expect(input).toHaveValue('run ID-JAG demo');
  await input.press('Enter');
  await expectHandoff(page, calls, '/dashboard');
});

for (const provider of ['pingone', 'pingfederate']) {
  test(`ordinary ${provider} login clears stale ID-JAG mode`, async ({ page }) => {
    let authenticated = false;
    await page.route('**/api/auth/oauth/status', (route) => route.fulfill({ json: { authenticated: false } }));
    await page.route('**/api/auth/oauth/user/status', (route) => route.fulfill({ json: authenticated
      ? { authenticated: true, oauthProvider: provider, user: { id: 'demo-user', username: 'demoUser', role: 'customer' } }
      : { authenticated: false } }));
    await page.route('**/api/auth/session', (route) => route.fulfill({ json: { authenticated: false } }));
    await page.goto(DEMO_PATH);
    await expect(page.getByRole('button', { name: 'Run mock demo' })).toBeVisible();
    await seedStaleMode(page);
    authenticated = true;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Run mock demo' })).toBeVisible();
    await expectModeCleared(page);
  });
}

test('switching provider clears ID-JAG mode before leaving the page', async ({ page }) => {
  await mockCustomerDashboard(page);
  const configPosts = [];
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
  const toggle = page.getByRole('button', { name: 'Toggle OAuth login provider' });
  await expect(toggle).toBeVisible();
  await seedStaleMode(page);
  await toggle.click();
  await expect(page).toHaveURL(/\/logout$/);
  expect(configPosts).toEqual([{ oauth_provider: 'pingfederate' }]);
  await expectModeCleared(page);
});
