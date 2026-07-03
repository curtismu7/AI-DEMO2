# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customer-dashboard.spec.js >> Customer dashboard (UserDashboard) >> when /transactions/my returns 403, dashboard still renders Your Accounts heading
- Location: tests/e2e/customer-dashboard.spec.js:54:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/dashboard
Call log:
  - navigating to "https://api.ping.demo:4000/dashboard", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * @file customer-dashboard.spec.js
  3   |  * Playwright E2E tests for the end-user dashboard (UserDashboard): accounts, transactions,
  4   |  * scope-forbidden path, agent-result refresh, navigation. API is fully mocked — no banking_api_server.
  5   |  */
  6   | 
  7   | const { test, expect } = require('@playwright/test');
  8   | const {
  9   |   mockCustomerDashboard,
  10  |   SAMPLE_TRANSACTIONS,
  11  | } = require('./helpers/customerDashboardMocks');
  12  | 
  13  | test.beforeEach(async ({ page }) => {
  14  |   await page.addInitScript(() => {
  15  |     try {
  16  |       localStorage.removeItem('userLoggedOut');
  17  |     } catch (_) {}
  18  |   });
  19  | });
  20  | 
  21  | /** BankingAgent can open after login; collapse the floating panel if visible. */
  22  | async function dismissBankingAgentPanel(page) {
  23  |   try {
  24  |     const collapse = page.getByRole('button', { name: 'Collapse agent' });
  25  |     await collapse.click({ timeout: 1500 });
  26  |   } catch (_) {
  27  |     /* panel already collapsed or not present */
  28  |   }
  29  | }
  30  | 
  31  | test.describe('Customer dashboard (UserDashboard)', () => {
  32  |   test('renders Your Accounts and live API account rows at /dashboard', async ({ page }) => {
  33  |     await mockCustomerDashboard(page);
  34  |     await page.goto('/dashboard');
  35  |     await dismissBankingAgentPanel(page);
  36  | 
  37  |     await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
  38  |     await expect(page.getByText('Primary Checking')).toBeVisible();
  39  |     // Balance uses toLocaleString; account number is masked in the collapsed card
  40  |     await expect(page.getByText('$1,500.00')).toBeVisible();
  41  |     await expect(page).toHaveURL(/\/dashboard/);
  42  |   });
  43  | 
  44  |   test('shows Recent Transactions from API when /transactions/my returns 200', async ({ page }) => {
  45  |     await mockCustomerDashboard(page, { transactionsResponse: SAMPLE_TRANSACTIONS });
  46  |     await page.goto('/dashboard');
  47  |     await dismissBankingAgentPanel(page);
  48  | 
  49  |     await expect(page.getByRole('heading', { name: 'Recent Transactions' })).toBeVisible({ timeout: 15000 });
  50  |     await expect(page.getByText('Payroll')).toBeVisible();
  51  |     await expect(page.getByText('ATM')).toBeVisible();
  52  |   });
  53  | 
  54  |   test('when /transactions/my returns 403, dashboard still renders Your Accounts heading', async ({
  55  |     page,
  56  |   }) => {
  57  |     await mockCustomerDashboard(page, {
  58  |       transactionsHandler: (route) =>
  59  |         route.fulfill({
  60  |           status: 403,
  61  |           contentType: 'application/json',
  62  |           body: JSON.stringify({ error: 'insufficient_scope', requiredScopes: ['banking:transactions:read'] }),
  63  |         }),
  64  |     });
> 65  |     await page.goto('/dashboard');
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/dashboard
  66  |     await dismissBankingAgentPanel(page);
  67  | 
  68  |     // Promise.all rejects on any error — accounts are not set from the API mock,
  69  |     // but the page skeleton (including the heading) still renders.
  70  |     await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
  71  |   });
  72  | 
  73  |   test('Log Out button navigates to unified /api/auth/logout', async ({ page }) => {
  74  |     await mockCustomerDashboard(page);
  75  |     await page.route('**/api/auth/logout**', (route) =>
  76  |       route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
  77  |     );
  78  | 
  79  |     await page.goto('/dashboard');
  80  |     await dismissBankingAgentPanel(page);
  81  |     const logoutBtn = page.getByRole('button', { name: 'Log Out' });
  82  |     await expect(logoutBtn).toBeVisible({ timeout: 15000 });
  83  | 
  84  |     const logoutReq = page.waitForRequest(
  85  |       (r) => r.url().includes('/api/auth/logout') && r.method() === 'GET',
  86  |       { timeout: 15000 },
  87  |     );
  88  |     await logoutBtn.click();
  89  |     const req = await logoutReq;
  90  |     expect(req.url()).toMatch(/\/api\/auth\/logout/);
  91  |   });
  92  | 
  93  |   test('banking-agent-result (confirm) triggers silent data refresh (accounts/my)', async ({ page }) => {
  94  |     await mockCustomerDashboard(page);
  95  |     await page.goto('/dashboard');
  96  |     await dismissBankingAgentPanel(page);
  97  |     await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
  98  | 
  99  |     const refreshReq = page.waitForRequest(
  100 |       (r) => r.url().includes('/api/accounts/my') && r.method() === 'GET',
  101 |       { timeout: 10000 },
  102 |     );
  103 |     await page.evaluate(() => {
  104 |       window.dispatchEvent(new CustomEvent('banking-agent-result', { detail: { type: 'confirm' } }));
  105 |     });
  106 |     await refreshReq;
  107 |   });
  108 | 
  109 |   test('MCP Inspector route renders the inspector page', async ({ page }) => {
  110 |     await mockCustomerDashboard(page);
  111 |     await page.route('**/api/mcp/inspector/context**', (route) =>
  112 |       route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  113 |     );
  114 |     await page.route('**/api/mcp/inspector/tools**', (route) =>
  115 |       route.fulfill({
  116 |         status: 200,
  117 |         contentType: 'application/json',
  118 |         body: JSON.stringify({ tools: [], _source: 'local_catalog' }),
  119 |       }),
  120 |     );
  121 |     // Route is open to all users; the sidebar link is hidden for customers but the page is accessible
  122 |     await page.goto('/mcp-inspector');
  123 |     await expect(page).toHaveURL(/\/mcp-inspector/, { timeout: 15000 });
  124 |     await expect(page.getByRole('heading', { name: 'MCP Inspector' })).toBeVisible({ timeout: 15000 });
  125 |   });
  126 | 
  127 |   test('redirects /admin to home for customer session', async ({ page }) => {
  128 |     await mockCustomerDashboard(page);
  129 |     await page.goto('/admin');
  130 |     await dismissBankingAgentPanel(page);
  131 | 
  132 |     await expect(page).not.toHaveURL(/\/admin$/);
  133 |   });
  134 | });
  135 | 
```