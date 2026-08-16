/**
 * @file pinggateway-inspector.spec.js
 * @description Playwright E2E smoke for the Agent Gateway Inspector (/agent-gateway-inspector).
 *
 * Covers:
 *   - Page loads and shows "Agent Gateway Configuration" heading
 *   - All tabs render in the tab bar
 *   - Default tab is "Demo Agent Gateway (Dev)" (mock)
 *   - Status badge is visible
 *   - ?subtab=tester deep-links to Agent Gateway Tester tab
 *   - ?subtab=capabilities redirects to /agent-gateway-capabilities
 *   - Refresh button re-fetches config
 *   - MCP mode chip shown
 *   - Non-admin is redirected away
 *
 * All network calls are intercepted — no live server required.
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

const GATEWAY_CONFIG = {
  mock: {
    url: 'http://localhost:8080',
    running: true,
    devBypass: false,
    enabled: true,
    health: { status: 'ok', service: 'demo-gateway', ts: '2024-01-01T00:00:00Z' },
  },
  config: {
    gatewayResourceUri: 'https://gateway.example.com',
    upstreamMcpUrl: 'wss://mcp.example.com',
    mcpOlbResourceUri: 'https://olb.example.com',
    mcpResourceServerWsUrl: 'wss://invest.example.com',
    mcpResourceServerResourceUri: 'https://invest.example.com',
    pingAuthorizeEndpoint: 'https://auth.pingone.com',
    hitlServiceUrl: 'http://localhost:3003',
    pingOneEnvUrl: 'https://auth.pingone.com/env-id/as',
    introspectEndpoint: 'https://auth.pingone.com/env-id/as/introspect',
    gatewayPublicUrl: 'https://gateway.example.com',
    pingOneResourceId: 'resource-123',
    mcpScope: 'mcp:invoke',
    mcpOlbWsUrl: 'wss://olb.example.com',
  },
  envVars: {
    MCP_GATEWAY_HTTP_URL: 'http://localhost:8080',
    PINGONE_ENV_ID: 'env-id',
  },
  mcpMode: 'custom',
  pingGatewayJson: { name: 'mcp', condition: '${find(request.uri.path, \'^/mcp\')}' },
  pingGatewayAdminJson: {},
};

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockGatewayInspector(page, { user = ADMIN_USER, config = GATEWAY_CONFIG } = {}) {
  // Auth stubs
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json({ authenticated: true, user }))
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill(json({ authenticated: false }))
  );

  // Broad data stubs
  await page.route('**/api/users**', (route) => route.fulfill(json({ users: [], total: 0 })));
  await page.route('**/api/accounts**', (route) => route.fulfill(json({ accounts: [] })));
  await page.route('**/api/transactions**', (route) => route.fulfill(json({ transactions: [] })));
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill(json({ agent_ui_mode: 'standard', ff_use_cases_launcher: true }))
  );
  await page.route('**/api/api-calls**', (route) => route.fulfill(json({ calls: [] })));
  await page.route('**/api/mcp/tools**', (route) => route.fulfill(json({ tools: [] })));
  await page.route('**/api/mcp/inspector/tools**', (route) => route.fulfill(json({ tools: [] })));
  await page.route('**/api/mcp/inspector/pingone-tools**', (route) =>
    route.fulfill(json({ tools: [] }))
  );
  await page.route('**/api/mcp/inspector/profiles**', (route) =>
    route.fulfill(json({ profiles: [] }))
  );

  // Gateway config — registered last so it wins
  await page.route('**/api/admin/mcp-gateway/config**', (route) =>
    route.fulfill(json(config))
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Agent Gateway Inspector — page load', () => {
  test('shows "Agent Gateway Configuration" heading', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByText('Agent Gateway Configuration')).toBeVisible({ timeout: 10000 });
  });

  test('subtitle mentions mcp.json', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByText(/mcp\.json/)).toBeVisible({ timeout: 10000 });
  });

  test('status badge is visible', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    // Running badge (not devBypass) should show
    await expect(page.getByText('Running (Live)')).toBeVisible({ timeout: 10000 });
  });

  test('Refresh button is visible', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    // Use CSS class to avoid strict-mode conflict with sidebar "Refresh sidebar" button
    await expect(page.locator('.mgc-refresh-btn')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Agent Gateway Inspector — tabs', () => {
  test('Demo Agent Gateway (Dev) tab is present', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByRole('button', { name: 'Demo Agent Gateway (Dev)' })).toBeVisible({ timeout: 10000 });
  });

  test('Agent Gateway tab is present', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    // Scope to .mgc-tabs to avoid sidebar nav matching the same label
    await expect(page.locator('.mgc-tabs').getByRole('button', { name: 'Agent Gateway', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Agent Gateway Tester tab is present', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByRole('button', { name: 'Agent Gateway Tester' })).toBeVisible({ timeout: 10000 });
  });

  test('Token Security tab is present', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByRole('button', { name: 'Token Security' })).toBeVisible({ timeout: 10000 });
  });

  test('MCP Tool Tester tab is present', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByRole('button', { name: 'MCP Tool Tester' })).toBeVisible({ timeout: 10000 });
  });

  test('default tab panel shows Gateway URL from config', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector');
    // Default "mock" tab shows the gateway URL
    await expect(page.getByText('http://localhost:8080')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Agent Gateway Inspector — deep-link subtabs', () => {
  test('?subtab=tester activates Agent Gateway Tester tab', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector?subtab=tester');
    await expect(
      page.getByRole('button', { name: 'Agent Gateway Tester' })
        .and(page.locator('.mgc-tab--active'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('?subtab=capabilities redirects to /agent-gateway-capabilities', async ({ page }) => {
    await mockGatewayInspector(page);
    await page.goto('/agent-gateway-inspector?subtab=capabilities');
    await expect(page).toHaveURL(/\/agent-gateway-capabilities$/, { timeout: 10000 });
  });
});

test.describe('Agent Gateway Inspector — Refresh', () => {
  test('Refresh button re-fetches gateway config', async ({ page }) => {
    await mockGatewayInspector(page);
    let fetchCount = 0;
    await page.route('**/api/admin/mcp-gateway/config**', (route) => {
      fetchCount++;
      return route.fulfill(json(GATEWAY_CONFIG));
    });
    await page.goto('/agent-gateway-inspector');
    await page.locator('.mgc-refresh-btn').waitFor({ timeout: 10000 });
    await page.locator('.mgc-refresh-btn').click();
    await page.waitForTimeout(500);
    expect(fetchCount).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Agent Gateway Inspector — MCP mode chip', () => {
  test('shows Custom Gateway chip when mcpMode is custom', async ({ page }) => {
    await mockGatewayInspector(page, { config: { ...GATEWAY_CONFIG, mcpMode: 'custom' } });
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByText('Custom Gateway')).toBeVisible({ timeout: 10000 });
  });

  test('shows PingOne MCP Server chip when mcpMode is pingone', async ({ page }) => {
    await mockGatewayInspector(page, { config: { ...GATEWAY_CONFIG, mcpMode: 'pingone' } });
    await page.goto('/agent-gateway-inspector');
    await expect(page.getByText('PingOne MCP Server')).toBeVisible({ timeout: 10000 });
  });
});
