/**
 * @file agent-flow-inspector.spec.js
 * @description Playwright E2E smoke for the Agent Flow Inspector (/agent-flow-inspector).
 *
 * Covers:
 *   - Page renders the UnifiedTokenFlowInspector with 3 tabs
 *   - Default active tab is "Flow & Tokens"
 *   - Tab switching works (Token Chain, Token Transform)
 *   - "Flow & Tokens" tab is accessible
 *   - Unauthenticated user is redirected
 *
 * All network calls are intercepted — no live server required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/agent-flow-inspector.spec.js
 */

const { test, expect } = require('@playwright/test');

const ADMIN_USER = {
  id: 'admin-flow-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'Flow',
  name: 'Admin Flow',
  role: 'admin',
};

const GATEWAY_CONFIG = {
  mock: { url: 'http://localhost:8080', running: false, devBypass: false, enabled: false },
  config: {
    upstreamMcpUrl: '',
    mcpOlbResourceUri: '',
    pingOneEnvUrl: '',
    introspectEndpoint: '',
    gatewayPublicUrl: '',
    pingOneResourceId: '',
    mcpScope: 'mcp:invoke',
  },
  envVars: {},
  mcpMode: 'custom',
  pingGatewayJson: {},
  pingGatewayAdminJson: {},
};

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockFlowInspector(page, { user = ADMIN_USER } = {}) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json({ authenticated: true, user }))
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill(json({ authenticated: false }))
  );
  await page.route('**/api/users**', (route) => route.fulfill(json({ users: [], total: 0 })));
  await page.route('**/api/accounts**', (route) => route.fulfill(json({ accounts: [] })));
  await page.route('**/api/transactions**', (route) => route.fulfill(json({ transactions: [] })));
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill(json({ agent_ui_mode: 'standard', ff_use_cases_launcher: true }))
  );
  await page.route('**/api/api-calls**', (route) => route.fulfill(json({ calls: [] })));
  await page.route('**/api/mcp/**', (route) => route.fulfill(json({ tools: [], calls: [] })));
  await page.route('**/api/admin/mcp-gateway/config**', (route) =>
    route.fulfill(json(GATEWAY_CONFIG))
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Agent Flow Inspector — page load', () => {
  test('renders the Flow & Tokens tab by default', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    await expect(
      page.getByRole('tab', { name: 'Flow & Tokens' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('Flow & Tokens tab is selected by default', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    const tab = page.getByRole('tab', { name: 'Flow & Tokens' });
    await tab.waitFor({ timeout: 10000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  test('Token Chain tab is present', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    await expect(page.getByRole('tab', { name: 'Token Chain' })).toBeVisible({ timeout: 10000 });
  });

  test('Token Transform tab is present', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    await expect(page.getByRole('tab', { name: 'Token Transform' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Agent Flow Inspector — tab switching', () => {
  test('clicking Token Chain tab makes it active', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    // Scope to .utfi-tabs — TokenChainTraceRail also renders a "Token Chain" tab inside
    const tab = page.locator('.utfi-tabs').getByRole('tab', { name: 'Token Chain' });
    await tab.waitFor({ timeout: 10000 });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Token Transform tab makes it active', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    const tab = page.locator('.utfi-tabs').getByRole('tab', { name: 'Token Transform' });
    await tab.waitFor({ timeout: 10000 });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  test('switching away from Flow & Tokens deselects it', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    const flowTab = page.locator('.utfi-tabs').getByRole('tab', { name: 'Flow & Tokens' });
    const chainTab = page.locator('.utfi-tabs').getByRole('tab', { name: 'Token Chain' });
    await chainTab.waitFor({ timeout: 10000 });
    await chainTab.click();
    await expect(flowTab).toHaveAttribute('aria-selected', 'false');
  });

  test('Token Transform tab shows RFC 8693 hint text', async ({ page }) => {
    await mockFlowInspector(page);
    await page.goto('/agent-flow-inspector');
    const tab = page.locator('.utfi-tabs').getByRole('tab', { name: 'Token Transform' });
    await tab.waitFor({ timeout: 10000 });
    await tab.click();
    // Scope to the transform-view hint paragraph to avoid strict mode with other RFC refs
    await expect(page.locator('.utfi-rfc-inline-hint')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Agent Flow Inspector — auth guard', () => {
  test('unauthenticated user does not see inspector tabs', async ({ page }) => {
    // The deep-link route is inside a nested AppShell that may not redirect cleanly
    // in tests, but the UnifiedTokenFlowInspector itself requires auth to render.
    // Verify the inspector tablist is absent when auth returns unauthenticated.
    await page.route('**/api/auth/oauth/status', (route) =>
      route.fulfill(json({ authenticated: false }))
    );
    await page.route('**/api/auth/oauth/user/status', (route) =>
      route.fulfill(json({ authenticated: false }))
    );
    await page.route('**/api/admin/config**', (route) =>
      route.fulfill(json({ agent_ui_mode: 'standard' }))
    );
    await page.route('**/api/admin/mcp-gateway/config**', (route) =>
      route.fulfill(json({ mock: {}, config: {}, envVars: {}, mcpMode: 'custom', pingGatewayJson: {}, pingGatewayAdminJson: {} }))
    );
    await page.goto('/agent-flow-inspector');
    await page.waitForTimeout(2000);
    // Either redirected away OR the tablist never mounted
    const tablist = page.locator('.utfi-tabs');
    const onPage = page.url().includes('/agent-flow-inspector');
    if (onPage) {
      // If the shell rendered without redirect, the tablist must not be visible
      await expect(tablist).not.toBeVisible();
    } else {
      expect(page.url()).not.toContain('/agent-flow-inspector');
    }
  });
});
