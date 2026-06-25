/**
 * @file customerDashboardMocks.js
 * Shared route mocks for customer (end-user) dashboard Playwright specs.
 * No live API server required.
 */

const DEFAULT_CUSTOMER = {
  id: 'user-123',
  username: 'testuser',
  email: 'testuser@bank.com',
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  role: 'customer',
};

const SAMPLE_ACCOUNTS = {
  accounts: [
    {
      id: 'acc_001',
      name: 'Primary Checking',
      accountNumber: 'CHK-001',
      accountType: 'checking',
      balance: 1500.0,
    },
    {
      id: 'acc_002',
      name: 'Savings',
      accountNumber: 'SAV-002',
      accountType: 'savings',
      balance: 8200.5,
    },
  ],
};

const SAMPLE_TRANSACTIONS = {
  transactions: [
    { id: 'txn_1', type: 'deposit', amount: 500, description: 'Payroll', createdAt: '2026-03-01T10:00:00.000Z', accountInfo: 'Checking', clientType: 'enduser', performedBy: 'Test User' },
    { id: 'txn_2', type: 'withdrawal', amount: 100, description: 'ATM', createdAt: '2026-03-05T14:30:00.000Z', accountInfo: 'Checking', clientType: 'enduser', performedBy: 'Test User' },
  ],
};

const EMPTY_TOKEN_EVENTS = { tokenEvents: [] };

/**
 * Installs mocks for a signed-in customer: OAuth status, accounts/my, transactions/my, config, token preview.
 * @param {import('@playwright/test').Page} page
 * @param {{ accountsResponse?: object, transactionsHandler?: (route: import('@playwright/test').Route) => void, user?: object }} [opts]
 */
async function mockCustomerDashboard(page, opts = {}) {
  const user = opts.user || DEFAULT_CUSTOMER;
  const accountsBody = opts.accountsResponse || SAMPLE_ACCOUNTS;

  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }),
    }),
  );

  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }),
    }),
  );

  await page.route('**/api/accounts/my**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(accountsBody),
    }),
  );

  if (typeof opts.transactionsHandler === 'function') {
    await page.route('**/api/transactions/my**', opts.transactionsHandler);
  } else {
    await page.route('**/api/transactions/my**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(opts.transactionsResponse || SAMPLE_TRANSACTIONS),
      }),
    );
  }

  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ config: {} }),
    }),
  );

  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_TOKEN_EVENTS),
    }),
  );

  // BankingAgent and TokenChainContext call /api/auth/session independently of the OAuth status endpoints
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }),
    }),
  );

  await page.route('**/api/token-chain**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_TOKEN_EVENTS),
    }),
  );

  // Fire-and-forget POST from the UI; real endpoint returns 201
  await page.route('**/api/admin/app-events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );

  // PingOne connectivity indicator — returns empty config when unconfigured
  await page.route('**/api/pingone-test/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );

  // UserDashboard only renders the banking column when this flag is true (split3 layout)
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: [{ id: 'ff_show_banking_in_middle_agent', value: true }] }),
    }),
  );

  await page.route('**/ws**', (route) => route.abort());

  // ThemeContext fetches /api/config/vertical on mount — stub with no manifest
  // so the default banking layout (not retail) is used and "Your Accounts" is visible.
  await page.route('**/api/config/vertical**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ manifest: null }),
    }),
  );
}

module.exports = {
  DEFAULT_CUSTOMER,
  SAMPLE_ACCOUNTS,
  SAMPLE_TRANSACTIONS,
  mockCustomerDashboard,
};
