/**
 * @file mcp-inspector.spec.js
 * @description Functional smoke for the Demo MCP Inspector (/mcp-inspector).
 * Covers the schema-driven invoke flow that replaced the raw JSON textarea:
 *   1. The tabbed tool catalog renders chips (Read / Write / Reasoning).
 *   2. Selecting a chip opens the per-parameter form, not a JSON textarea.
 *   3. Calling with a missing required param is blocked client-side.
 *   4. A valid Call hits /invoke and surfaces "Completed in N ms" + Last result.
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

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockInspector(page) {
  // Broad data stubs first (mirrors url-smoke.spec.js). More specific MCP
  // inspector routes are registered LAST so they win — Playwright matches route
  // handlers in reverse registration order.
  const stubs = [
    ['**/api/users**', { users: [], total: 0 }],
    ['**/api/accounts**', { accounts: [] }],
    ['**/api/transactions**', { transactions: [] }],
    ['**/api/admin/**', {}],
    ['**/api/token-chain**', { tokenChain: [], mcpToolCallsChain: [], metadata: {} }],
    ['**/api/mcp/**', {}],
    ['**/api/monitoring/**', {}],
    ['**/api/config**', {}],
    ['**/api/feature-flags**', { flags: {} }],
    ['**/api/pingone/**', {}],
    ['**/api/langchain/**', {}],
    ['**/api/health/**', { status: 'ok' }],
  ];
  for (const [pattern, body] of stubs) {
    await page.route(pattern, (route) => route.fulfill(json(body)));
  }

  // Admin-authenticated session.
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json({ authenticated: true, user: ADMIN_USER })),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill(json({ authenticated: false })),
  );

  // MCP inspector endpoints the page drives (registered last → take precedence).
  await page.route('**/api/mcp/inspector/context', (route) =>
    route.fulfill(json({ mcpHosts: null, flow: [], mcpProtocolVersion: '2025-06-18' })),
  );
  await page.route('**/api/mcp/inspector/tools', (route) =>
    route.fulfill(json({ tools: TOOLS, _source: 'mcp_server', frames: null })),
  );
  await page.route('**/api/mcp/inspector/invoke', (route) =>
    route.fulfill(json(INVOKE_RESULT)),
  );
}

test.describe('Demo MCP Inspector — chip → Call → result', () => {
  test.beforeEach(async ({ page }) => {
    await mockInspector(page);
  });

  test('renders the tabbed catalog and the renamed title', async ({ page }) => {
    await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Demo MCP Inspector', level: 1 })).toBeVisible();
    // Read tab shows both stub tools; Reasoning shows none.
    await expect(page.getByRole('tab', { name: /Read/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'get_my_accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'get_account_balance', exact: true })).toBeVisible();
  });

  test('blocks Call when a required param is empty, then succeeds when filled', async ({ page }) => {
    await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });

    // Select the tool with a required param → schema form (not a JSON textarea).
    await page.getByRole('button', { name: 'get_account_balance', exact: true }).click();
    await expect(page.locator('#mcp-param-account_id')).toBeVisible();

    // Call with the field empty → client-side block, no result line.
    await page.getByRole('button', { name: 'Call get_account_balance' }).click();
    await expect(page.getByText('Required: account_id')).toBeVisible();
    await expect(page.getByText(/Completed in/)).toHaveCount(0);

    // Fill the param and call → success status + Last result panel.
    await page.locator('#mcp-param-account_id').fill('acc-123');
    await page.getByRole('button', { name: 'Call get_account_balance' }).click();
    await expect(page.getByText(/Completed in \d+ ms/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Last result' })).toBeVisible();
  });
});
