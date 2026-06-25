/**
 * @file customer-dashboard.spec.js
 * Playwright E2E tests for the end-user dashboard (UserDashboard): accounts, transactions,
 * scope-forbidden path, agent-result refresh, navigation. API is fully mocked — no banking_api_server.
 */

const { test, expect } = require('@playwright/test');
const {
  mockCustomerDashboard,
  SAMPLE_TRANSACTIONS,
} = require('./helpers/customerDashboardMocks');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('userLoggedOut');
    } catch (_) {}
  });
});

/** BankingAgent can open after login; collapse the floating panel if visible. */
async function dismissBankingAgentPanel(page) {
  try {
    const collapse = page.getByRole('button', { name: 'Collapse agent' });
    await collapse.click({ timeout: 1500 });
  } catch (_) {
    /* panel already collapsed or not present */
  }
}

test.describe('Customer dashboard (UserDashboard)', () => {
  test('renders Your Accounts and live API account rows at /dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissBankingAgentPanel(page);

    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Primary Checking')).toBeVisible();
    // Balance uses toLocaleString; account number is masked in the collapsed card
    await expect(page.getByText('$1,500.00')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows Recent Transactions from API when /transactions/my returns 200', async ({ page }) => {
    await mockCustomerDashboard(page, { transactionsResponse: SAMPLE_TRANSACTIONS });
    await page.goto('/dashboard');
    await dismissBankingAgentPanel(page);

    await expect(page.getByRole('heading', { name: 'Recent Transactions' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Payroll')).toBeVisible();
    await expect(page.getByText('ATM')).toBeVisible();
  });

  test('when /transactions/my returns 403, dashboard still renders Your Accounts heading', async ({
    page,
  }) => {
    await mockCustomerDashboard(page, {
      transactionsHandler: (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'insufficient_scope', requiredScopes: ['banking:transactions:read'] }),
        }),
    });
    await page.goto('/dashboard');
    await dismissBankingAgentPanel(page);

    // Promise.all rejects on any error — accounts are not set from the API mock,
    // but the page skeleton (including the heading) still renders.
    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
  });

  test('Log Out button navigates to unified /api/auth/logout', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.route('**/api/auth/logout**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
    );

    await page.goto('/dashboard');
    await dismissBankingAgentPanel(page);
    const logoutBtn = page.getByRole('button', { name: 'Log Out' });
    await expect(logoutBtn).toBeVisible({ timeout: 15000 });

    const logoutReq = page.waitForRequest(
      (r) => r.url().includes('/api/auth/logout') && r.method() === 'GET',
      { timeout: 15000 },
    );
    await logoutBtn.click();
    const req = await logoutReq;
    expect(req.url()).toMatch(/\/api\/auth\/logout/);
  });

  test('banking-agent-result (confirm) triggers silent data refresh (accounts/my)', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissBankingAgentPanel(page);
    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });

    const refreshReq = page.waitForRequest(
      (r) => r.url().includes('/api/accounts/my') && r.method() === 'GET',
      { timeout: 10000 },
    );
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('banking-agent-result', { detail: { type: 'confirm' } }));
    });
    await refreshReq;
  });

  test('MCP Inspector route renders the inspector page', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.route('**/api/mcp/inspector/context**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
    );
    await page.route('**/api/mcp/inspector/tools**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tools: [], _source: 'local_catalog' }),
      }),
    );
    // Route is open to all users; the sidebar link is hidden for customers but the page is accessible
    await page.goto('/mcp-inspector');
    await expect(page).toHaveURL(/\/mcp-inspector/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'MCP Inspector' })).toBeVisible({ timeout: 15000 });
  });

  test('redirects /admin to home for customer session', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/admin');
    await dismissBankingAgentPanel(page);

    await expect(page).not.toHaveURL(/\/admin$/);
  });
});
