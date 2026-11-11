/**
 * @file pinggateway-inspector.spec.js
 * @description Playwright E2E smoke for the Agent Gateway Inspector (/agent-gateway-inspector,
 * AgentGatewayInspectorClean on the shared InspectorLayout). It replaced the old tabbed
 * "Agent Gateway Configuration" page (McpGatewayConfig), which no longer has a route.
 *
 * Covers:
 *   - Page loads with the "Agent Gateway Inspector" heading
 *   - The Live / Simulated authz / Unavailable status chip follows GET /api/mcp-gateway/active
 *   - The Gateway picker offers PingOne Agent Gateway and the Demo MCP Gateway (Node)
 *   - The Authz Real / Simulated toggle PATCHes the feature flag
 *   - A decision the gateway reported (GET /api/admin/agent-gateway/decisions) is listed under Calls
 *   - Send posts a tool call to /api/mcp-gateway/test and lists it
 *   - The "Gateway tester" link and the old /pinggateway-inspector, ?subtab=capabilities redirects
 *
 * Every /api call is stubbed — no live server or gateway required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/pinggateway-inspector.spec.js
 */

const { test, expect } = require('@playwright/test');

const ADMIN_USER = {
  id: 'admin-gw-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'GW',
  name: 'Admin GW',
  role: 'admin',
};

const ACTIVE_LIVE = { usePingGateway: true, simulated: false, url: 'http://localhost:8080' };

const DECISION = {
  ts: '2026-11-10T12:00:00.000Z',
  tool: 'get_my_accounts',
  decision: 'PERMIT',
  correlationId: 'corr-1',
  sub: 'user-1',
  clientId: 'client-1',
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ user?: object, active?: object|null, activeStatus?: number, decisions?: object[] }} [opts]
 */
async function mockGatewayInspector(page, { user = ADMIN_USER, active = ACTIVE_LIVE, activeStatus = 200, decisions = [] } = {}) {
  // Lowest-priority catch-all first (the most recently added matching route runs first, so everything below
  // wins): an /api call nobody stubbed otherwise reaches whatever answers the dev-server proxy, and a running
  // BFF replies 401, which opens the global "Sign in required" modal over the page.
  await page.route('**/api/**', (route) => route.fulfill(json({})));
  await page.route('**/api/auth/oauth/status', (route) => route.fulfill(json({ authenticated: true, user })));
  await page.route('**/api/auth/oauth/user/status', (route) => route.fulfill(json({ authenticated: false })));
  await page.route('**/api/auth/session**', (route) => route.fulfill(json({ authenticated: true, user })));
  await page.route('**/api/admin/config**', (route) => route.fulfill(json({ config: {} })));
  await page.route('**/api/admin/feature-flags**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill(json({ ok: true }));
    return route.fulfill(json({ flags: [] }));
  });
  await page.route('**/api/config/vertical**', (route) => route.fulfill(json({ manifest: null })));
  await page.route('**/api/token-chain**', (route) => route.fulfill(json({ tokenEvents: [] })));
  await page.route('**/api/mcp/inspector/tools**', (route) => route.fulfill(json({ tools: [] })));
  await page.route('**/api/admin/agent-gateway/logs**', (route) => route.fulfill(json({ ok: true, lines: [] })));
  await page.route('**/api/admin/agent-gateway/decisions**', (route) => route.fulfill(json({ decisions })));
  await page.route('**/api/mcp-gateway/active**', (route) =>
    route.fulfill(json(active ?? { error: 'unauthorized' }, activeStatus)));
}

const hero = (page) => page.locator('.insp-hero-meta');

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Agent Gateway Inspector — page load', () => {
  test('shows the "Agent Gateway Inspector" heading', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByRole('heading', { level: 1, name: 'Agent Gateway Inspector' })).toBeVisible({ timeout: 15000 });
  });

  test('status chip says Live when the gateway reports real authz', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(hero(page).getByText('Live', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('status chip says Simulated authz when the gateway reports simulated authz', async ({ page }) => {
    await mockGatewayInspector(page, { active: { ...ACTIVE_LIVE, simulated: true } });
    await page.goto('/agent-gateway-inspector');
    await expect(hero(page).getByText('Simulated authz')).toBeVisible({ timeout: 15000 });
  });

  test('status chip says Unavailable when the gateway status call is refused', async ({ page }) => {
    await mockGatewayInspector(page, { active: null, activeStatus: 401 });
    await page.goto('/agent-gateway-inspector');
    await expect(hero(page).getByText('Unavailable')).toBeVisible({ timeout: 15000 });
    // The 401 is answered on the chip, not with the global sign-in modal.
    await expect(page.getByRole('dialog', { name: 'Sign in required' })).toHaveCount(0);
  });
});

test.describe('Agent Gateway Inspector — gateway and authz controls', () => {
  test('the Gateway picker offers PingOne Agent Gateway and the Demo MCP Gateway (Node)', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    const picker = page.locator('#insp-source');
    await expect(picker).toHaveValue('ping', { timeout: 15000 });
    await expect(picker.locator('option', { hasText: 'PingOne Agent Gateway' })).toHaveCount(1);
    await expect(picker.locator('option', { hasText: 'Demo MCP Gateway (Node)' })).toHaveCount(1);
  });

  test('the Gateway picker reads Node when the gateway is not PingGateway', async ({ page }) => {
    await mockGatewayInspector(page, { active: { ...ACTIVE_LIVE, usePingGateway: false } });
    await page.goto('/agent-gateway-inspector');
    await expect(page.locator('#insp-source')).toHaveValue('node', { timeout: 15000 });
  });

  test('Authz Real is pressed for live authz; choosing Simulated PATCHes ff_authorize_real=false', async ({ page }) => {
    await mockGatewayInspector(page);
    let patched = null;
    await page.route('**/api/admin/feature-flags**', (route) => {
      if (route.request().method() === 'PATCH') {
        patched = route.request().postDataJSON();
        return route.fulfill(json({ ok: true }));
      }
      return route.fulfill(json({ flags: [] }));
    });
    await page.goto('/agent-gateway-inspector');
    const authz = page.getByRole('group', { name: 'Authz' });
    await expect(authz.getByRole('button', { name: 'Real' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await authz.getByRole('button', { name: 'Simulated' }).click();
    await expect.poll(() => patched).toEqual({ updates: { ff_authorize_real: false } });
  });
});

test.describe('Agent Gateway Inspector — calls', () => {
  test('lists a decision the gateway reported', async ({ page }) => {
    await mockGatewayInspector(page, { decisions: [DECISION] });
    await page.goto('/agent-gateway-inspector');
    const calls = page.getByRole('complementary', { name: 'Calls' });
    await expect(calls.getByText('get_my_accounts')).toBeVisible({ timeout: 15000 });
    await expect(calls.getByText('PERMIT')).toBeVisible();
  });

  test('shows the empty state when the gateway has reported nothing', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByText('No calls yet.')).toBeVisible({ timeout: 15000 });
  });

  test('Send posts the tool call to /api/mcp-gateway/test and lists it', async ({ page }) => {
    await mockGatewayInspector(page);
    const posted = [];
    await page.route('**/api/mcp-gateway/test', (route) => {
      posted.push(route.request().postDataJSON());
      return route.fulfill(json({ ok: true, durationMs: 42, result: { content: [{ type: 'text', text: 'ok' }] } }));
    });
    await page.goto('/agent-gateway-inspector');
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeEnabled({ timeout: 15000 });
    // The label wraps the <select>, so its accessible name includes the option text; find it by its caption.
    const tool = await page.locator('label.insp-field').filter({ has: page.locator('span', { hasText: /^Tool$/ }) }).locator('select').inputValue();
    await send.click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ tool });
    await expect(page.getByRole('complementary', { name: 'Calls' }).getByText(tool).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Agent Gateway Inspector — links and redirects', () => {
  test('the "Gateway tester" link goes to /agent-gateway-capabilities', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await page.locator('.insp-related').getByRole('link', { name: 'Gateway tester' }).click({ timeout: 15000 });
    await expect(page).toHaveURL(/\/agent-gateway-capabilities$/, { timeout: 15000 });
  });

  test('the old /pinggateway-inspector URL redirects to /agent-gateway-inspector', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/pinggateway-inspector');
    await expect(page).toHaveURL(/\/agent-gateway-inspector$/, { timeout: 15000 });
  });

  test('the old /pinggateway-test URL redirects to /agent-gateway-capabilities', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/pinggateway-test');
    await expect(page).toHaveURL(/\/agent-gateway-capabilities$/, { timeout: 15000 });
  });
});
