/**
 * @file mcp-inspector.spec.js
 * @description Functional smoke for the MCP Inspector reached at /mcp-inspector, which now redirects to the
 * unified inspector (/pingone-mcp-inspector?source=banking). Covers the schema-driven invoke flow:
 *   1. /mcp-inspector lands on the unified inspector with the tools table (both stub tools listed).
 *   2. Picking a tool opens the per-parameter form, not a JSON textarea.
 *   3. Sending with a missing required param is blocked client-side (nothing is posted).
 *   4. A valid Send hits /invoke and shows "What the tool returned" plus a row in the Calls list.
 *
 * Auth + MCP endpoints are intercepted — no live API/MCP server required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/mcp-inspector.spec.js
 */

const { test, expect } = require('@playwright/test');

const ADMIN_USER = {
  id: 'admin-mcp-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'Mcp',
  name: 'Admin Mcp',
  role: 'admin',
};

// Two-tool catalog: a no-arg Read tool and a Read tool with a required param,
// so the test exercises both the empty form and required-field validation.
const TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List all bank accounts with balances and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
  },
  {
    name: 'get_account_balance',
    description: 'Get current balance for a specific account by ID.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
    requiredScopes: ['read'],
  },
];

const INVOKE_RESULT = {
  result: { content: [{ type: 'text', text: 'Balance: $1,234.56' }] },
  frames: {
    request: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_account_balance' } },
    response: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Balance: $1,234.56' }] } },
  },
};

const invokeCalls = [];
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockInspector(page) {
  // Lowest-priority catch-all first (the most recently added matching route runs first, so everything below
  // wins): an /api call nobody stubbed otherwise reaches whatever answers the dev-server proxy, and a running
  // BFF replies 401, which opens the global "Sign in required" modal over the page.
  await page.route('**/api/**', (route) => route.fulfill(json({})));
  await page.route('**/api/admin/feature-flags**', (route) => route.fulfill(json({ flags: [] })));
  await page.route('**/api/config/vertical**', (route) => route.fulfill(json({ manifest: null })));
  await page.route('**/api/token-chain**', (route) =>
    route.fulfill(json({ tokenChain: [], mcpToolCallsChain: [], metadata: {} })),
  );

  // Admin-authenticated session.
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json({ authenticated: true, user: ADMIN_USER })),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill(json({ authenticated: false })),
  );
  await page.route('**/api/auth/session**', (route) =>
    route.fulfill(json({ authenticated: true, user: ADMIN_USER })),
  );

  // MCP inspector endpoints the page drives (registered last → take precedence).
  await page.route('**/api/mcp/inspector/tools**', (route) =>
    route.fulfill(json({ tools: TOOLS, _source: 'mcp_server', frames: null })),
  );
  await page.route('**/api/mcp/inspector/invoke', (route) => {
    invokeCalls.push(route.request().postDataJSON());
    return route.fulfill(json(INVOKE_RESULT));
  });
}

const toolRow = (page, name) => page.locator('.insp-tools__pick', { hasText: new RegExp(`^${name}$`) });

test.describe('MCP Inspector — pick a tool → Send → result', () => {
  test.beforeEach(async ({ page }) => {
    invokeCalls.length = 0;
    await mockInspector(page);
  });

  test('/mcp-inspector lands on the unified inspector and lists the catalog', async ({ page }) => {
    await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/pingone-mcp-inspector\?source=banking/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'MCP Inspector', level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.insp-tools__count')).toHaveText('2 tools', { timeout: 15000 });
    await expect(toolRow(page, 'get_my_accounts')).toBeVisible();
    await expect(toolRow(page, 'get_account_balance')).toBeVisible();
  });

  test('blocks Send when a required param is empty, then succeeds when filled', async ({ page }) => {
    await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });

    // Pick the tool with a required param → schema form (not a JSON textarea).
    await toolRow(page, 'get_account_balance').click({ timeout: 15000 });
    const accountId = page.getByLabel(/^account_id/);
    await expect(accountId).toBeVisible();

    // Send with the field empty → client-side block: a "Required" message, nothing posted, no result card.
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Required: account_id')).toBeVisible();
    expect(invokeCalls).toHaveLength(0);
    await expect(page.getByRole('region', { name: 'What the tool returned' })).toHaveCount(0);

    // Fill the param and Send → the call is posted and its result shown.
    await accountId.fill('acc-123');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const result = page.getByRole('region', { name: 'What the tool returned' });
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result.getByText('Balance: $1,234.56')).toBeVisible();
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]).toMatchObject({ tool: 'get_account_balance', params: { account_id: 'acc-123' } });
  });
});
