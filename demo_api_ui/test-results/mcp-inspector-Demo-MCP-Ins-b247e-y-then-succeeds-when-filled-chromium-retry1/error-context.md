# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mcp-inspector.spec.js >> Demo MCP Inspector — chip → Call → result >> blocks Call when a required param is empty, then succeeds when filled
- Location: tests/e2e/mcp-inspector.spec.js:112:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/mcp-inspector
Call log:
  - navigating to "https://api.ping.demo:4000/mcp-inspector", waiting until "domcontentloaded"

```

# Test source

```ts
  13  |  *   cd demo_api_ui
  14  |  *   npx playwright test tests/e2e/mcp-inspector.spec.js
  15  |  */
  16  | 
  17  | const { test, expect } = require('@playwright/test');
  18  | 
  19  | const ADMIN_USER = {
  20  |   id: 'admin-mcp-id',
  21  |   username: 'admin',
  22  |   email: 'admin@example.com',
  23  |   firstName: 'Admin',
  24  |   lastName: 'Mcp',
  25  |   name: 'Admin Mcp',
  26  |   role: 'admin',
  27  | };
  28  | 
  29  | // Two-tool catalog: a no-arg Read tool and a Read tool with a required param,
  30  | // so the test exercises both the empty form and required-field validation.
  31  | const TOOLS = [
  32  |   {
  33  |     name: 'get_my_accounts',
  34  |     description: 'List all bank accounts with balances and status.',
  35  |     inputSchema: { type: 'object', properties: {}, required: [] },
  36  |     requiredScopes: ['read'],
  37  |   },
  38  |   {
  39  |     name: 'get_account_balance',
  40  |     description: 'Get current balance for a specific account by ID.',
  41  |     inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
  42  |     requiredScopes: ['read'],
  43  |   },
  44  | ];
  45  | 
  46  | const INVOKE_RESULT = {
  47  |   result: { content: [{ type: 'text', text: 'Balance: $1,234.56' }] },
  48  |   frames: {
  49  |     request: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_account_balance' } },
  50  |     response: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Balance: $1,234.56' }] } },
  51  |   },
  52  | };
  53  | 
  54  | const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  55  | 
  56  | async function mockInspector(page) {
  57  |   // Broad data stubs first (mirrors url-smoke.spec.js). More specific MCP
  58  |   // inspector routes are registered LAST so they win — Playwright matches route
  59  |   // handlers in reverse registration order.
  60  |   const stubs = [
  61  |     ['**/api/users**', { users: [], total: 0 }],
  62  |     ['**/api/accounts**', { accounts: [] }],
  63  |     ['**/api/transactions**', { transactions: [] }],
  64  |     ['**/api/admin/**', {}],
  65  |     ['**/api/token-chain**', { tokenChain: [], mcpToolCallsChain: [], metadata: {} }],
  66  |     ['**/api/mcp/**', {}],
  67  |     ['**/api/monitoring/**', {}],
  68  |     ['**/api/config**', {}],
  69  |     ['**/api/feature-flags**', { flags: {} }],
  70  |     ['**/api/pingone/**', {}],
  71  |     ['**/api/langchain/**', {}],
  72  |     ['**/api/health/**', { status: 'ok' }],
  73  |   ];
  74  |   for (const [pattern, body] of stubs) {
  75  |     await page.route(pattern, (route) => route.fulfill(json(body)));
  76  |   }
  77  | 
  78  |   // Admin-authenticated session.
  79  |   await page.route('**/api/auth/oauth/status', (route) =>
  80  |     route.fulfill(json({ authenticated: true, user: ADMIN_USER })),
  81  |   );
  82  |   await page.route('**/api/auth/oauth/user/status', (route) =>
  83  |     route.fulfill(json({ authenticated: false })),
  84  |   );
  85  | 
  86  |   // MCP inspector endpoints the page drives (registered last → take precedence).
  87  |   await page.route('**/api/mcp/inspector/context', (route) =>
  88  |     route.fulfill(json({ mcpHosts: null, flow: [], mcpProtocolVersion: '2025-06-18' })),
  89  |   );
  90  |   await page.route('**/api/mcp/inspector/tools', (route) =>
  91  |     route.fulfill(json({ tools: TOOLS, _source: 'mcp_server', frames: null })),
  92  |   );
  93  |   await page.route('**/api/mcp/inspector/invoke', (route) =>
  94  |     route.fulfill(json(INVOKE_RESULT)),
  95  |   );
  96  | }
  97  | 
  98  | test.describe('Demo MCP Inspector — chip → Call → result', () => {
  99  |   test.beforeEach(async ({ page }) => {
  100 |     await mockInspector(page);
  101 |   });
  102 | 
  103 |   test('renders the tabbed catalog and the renamed title', async ({ page }) => {
  104 |     await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });
  105 |     await expect(page.getByRole('heading', { name: 'Demo MCP Inspector', level: 1 })).toBeVisible();
  106 |     // Read tab shows both stub tools; Reasoning shows none.
  107 |     await expect(page.getByRole('tab', { name: /Read/ })).toBeVisible();
  108 |     await expect(page.getByRole('button', { name: 'get_my_accounts', exact: true })).toBeVisible();
  109 |     await expect(page.getByRole('button', { name: 'get_account_balance', exact: true })).toBeVisible();
  110 |   });
  111 | 
  112 |   test('blocks Call when a required param is empty, then succeeds when filled', async ({ page }) => {
> 113 |     await page.goto('/mcp-inspector', { waitUntil: 'domcontentloaded' });
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/mcp-inspector
  114 | 
  115 |     // Select the tool with a required param → schema form (not a JSON textarea).
  116 |     await page.getByRole('button', { name: 'get_account_balance', exact: true }).click();
  117 |     await expect(page.locator('#mcp-param-account_id')).toBeVisible();
  118 | 
  119 |     // Call with the field empty → client-side block, no result line.
  120 |     await page.getByRole('button', { name: 'Call get_account_balance' }).click();
  121 |     await expect(page.getByText('Required: account_id')).toBeVisible();
  122 |     await expect(page.getByText(/Completed in/)).toHaveCount(0);
  123 | 
  124 |     // Fill the param and call → success status + Last result panel.
  125 |     await page.locator('#mcp-param-account_id').fill('acc-123');
  126 |     await page.getByRole('button', { name: 'Call get_account_balance' }).click();
  127 |     await expect(page.getByText(/Completed in \d+ ms/)).toBeVisible();
  128 |     await expect(page.getByRole('heading', { name: 'Last result' })).toBeVisible();
  129 |   });
  130 | });
  131 | 
```