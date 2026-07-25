/**
 * @file banking-agent.spec.js
 * @description Playwright E2E regression tests for the single BankingAgent
 *   (post-Phase-4 UX).
 *
 * Post-Phase-4 model under test:
 *   - Customer /dashboard: middle placement is the default; the single agent
 *     auto-renders INLINE (portaled into `.ud-dashboard-inline-agent-host`)
 *     with `ba-mode-inline ba-split-column` chrome. There is NO floating FAB.
 *   - Admin /admin: Dashboard.js has no inline host, so the agent stays in
 *     floating chrome behind a `.banking-agent-fab`.
 *   - The old Actions dropdown (`button.ba-actions-trigger` text "Actions" →
 *     `.ba-actions-popout`) was removed entirely. Core banking actions (My
 *     Accounts … Transfer) are now reachable only via `/use-cases` (covered by
 *     that page's own e2e specs, e.g. use-cases-catalog.spec.js). Admin-only
 *     ops moved to a dedicated `Admin ▾` popout (`AdminToolsDropdown`,
 *     `[data-testid="admin-tools-trigger"]`).
 *
 * Covers:
 *   UNAUTHENTICATED LANDING
 *   - Floating agent FAB is not shown on /
 *
 *   AUTHENTICATED (post-login)
 *   - Customer agent renders inline on /dashboard (no FAB); admin opens via FAB
 *   - Panel shows role badge in header subtitle (Admin / Customer)
 *   - Inline title ends with "Assistant"; admin float title ends with "AI Agent"
 *   - Dashboard nav button (`.ba-left-auth-btn.primary`) shows My/Admin Dashboard
 *   - Login action buttons NOT shown when authenticated
 *   - Admin-only tools reachable from the Admin Tools popout
 *   - ?oauth=success URL param auto-renders / cleans the URL
 *
 * All API calls and OAuth status are intercepted — no live server required.
 */

const { test, expect } = require('@playwright/test');

// NOTE: this hook is duplicated inside each test.describe block below
// to ensure each describe group has a fresh localStorage state before tests run.

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER_USER = {
  id: 'user-123',
  username: 'testuser',
  email: 'testuser@bank.com',
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  role: 'customer',
};

const ADMIN_USER = {
  id: 'admin-1',
  username: 'admin',
  email: 'admin@bank.com',
  firstName: 'Alice',
  lastName: 'Admin',
  name: 'Alice Admin',
  role: 'admin',
};

const SAMPLE_ACCOUNTS = {
  accounts: [
    { id: 'acc_001', account_number: 'CHK-001', account_type: 'checking', balance: 1500.00 },
    { id: 'acc_002', account_number: 'SAV-002', account_type: 'savings',  balance: 8200.50 },
  ],
};

// UserDashboard formats transaction.createdAt (camelCase) with date-fns — snake_case breaks render.
const SAMPLE_TRANSACTIONS = {
  transactions: [
    { id: 'txn_1', type: 'deposit',    amount: 500,   description: 'Payroll',   createdAt: '2026-03-01T10:00:00.000Z' },
    { id: 'txn_2', type: 'withdrawal', amount: 100,   description: 'ATM',       createdAt: '2026-03-05T14:30:00.000Z' },
    { id: 'txn_3', type: 'transfer',   amount: 250,   description: 'Rent',      createdAt: '2026-03-10T09:15:00.000Z' },
  ],
};

const SAMPLE_BALANCE = { balance: 1500.00 };

const SAMPLE_TRANSACTION_CONFIRM = {
  id: 'txn_new_001',
  amount: 100,
  type: 'withdrawal',
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Mock both OAuth status endpoints as unauthenticated.
 */
async function mockUnauthenticated(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/mcp**', (route) => route.abort());
}

/**
 * Mock both OAuth status endpoints as a logged-in customer and stub data APIs.
 */
async function mockAuthenticatedCustomer(page, user = CUSTOMER_USER) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }) })
  );
  await page.route('**/api/auth/session**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }) })
  );
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_ACCOUNTS) })
  );
  await page.route('**/api/transactions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_TRANSACTIONS) })
  );
  await page.route('**/api/config/vertical**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ manifest: null }) })
  );
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ config: {} }) })
  );
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [] }) })
  );
  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) })
  );
  await page.route('**/api/token-chain**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) })
  );
  await page.route('**/api/admin/app-events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/api/pingone-test/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) })
  );
  await page.route('**/api/verticals/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) })
  );
  await page.route('**/api/health/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }) })
  );
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/mcp**', (route) => route.abort());
}

/**
 * Mock admin OAuth status (admin user logged in via /api/auth/oauth/status).
 */
async function mockAuthenticatedAdmin(page, user = ADMIN_USER) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }) })
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/api/auth/session**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }) })
  );
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_ACCOUNTS) })
  );
  await page.route('**/api/transactions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_TRANSACTIONS) })
  );
  await page.route('**/api/config/vertical**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ manifest: null }) })
  );
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ config: {} }) })
  );
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [] }) })
  );
  await page.route('**/api/admin/stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stats: { totalUsers: 0, totalAccounts: 0, totalTransactions: 0, totalBalance: 0, averageBalance: 0, activeUsers: 0 } }) })
  );
  await page.route('**/api/admin/activity/recent**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ logs: [] }) })
  );
  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) })
  );
  await page.route('**/api/token-chain**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) })
  );
  await page.route('**/api/admin/app-events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/api/pingone-test/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) })
  );
  await page.route('**/api/verticals/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) })
  );
  await page.route('**/api/health/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }) })
  );
  // Admin Tools popout (AdminToolsDropdown) — fixture matches config/adminTools.js.
  await page.route('**/api/admin-tools**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tools: [
        { id: 'lookup_customer', title: 'Look Up Customer', trigger: { type: 'chip', text: 'look up a customer' } },
      ] }) })
  );
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/mcp**', (route) => route.abort());
}

/**
 * Stub /api/mcp/tool to return a given result for one tool call.
 */
async function mockMcpTool(page, result) {
  await page.route('**/api/mcp/tool', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ result }) })
  );
}

/**
 * Open the admin-only "Admin ▾" tools popout (`AdminToolsDropdown`) idempotently.
 * Replaces the deleted Actions popout for admin-only ops (Task 5/9).
 *
 * @returns {import('@playwright/test').Locator} the popout's floating panel.
 */
async function openAdminToolsPanel(page) {
  const panel = page.locator('.ba-admin-tools-float');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-testid="admin-tools-trigger"]').click();
    await expect(panel).toBeVisible({ timeout: 10000 });
  }
  return panel;
}

/**
 * Wait for the single BankingAgent panel to be ready.
 *
 * - Customer `/dashboard`: middle placement is the default — the agent
 *   auto-renders inline (portaled into `.ud-dashboard-inline-agent-host`),
 *   there is NO floating FAB to click.
 * - Admin `/admin`: Dashboard.js has no inline host, so the agent stays in
 *   floating chrome behind a `.banking-agent-fab`; click it if present.
 */
async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  if (await panel.isVisible().catch(() => false)) return;
  // Race the inline panel (customer /dashboard auto-renders) against the
  // floating FAB (admin /admin needs a click). Whichever resolves first wins —
  // /admin (Dashboard.js) is heavy, so the FAB can take several seconds to
  // mount; waiting for it explicitly avoids the "no panel, no FAB yet" gap.
  const fab = page.locator('.banking-agent-fab');
  await Promise.race([
    panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
    fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  ]);
  if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
    await fab.first().click();
  }
  await expect(panel).toBeVisible({ timeout: 20000 });
}

// ─── UNAUTHENTICATED LANDING (no floating agent) ───────────────────────────────

test.describe('BankingAgent — unauthenticated landing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
    });
  });

  test('landing offers the guest agent FAB but does not auto-open a panel', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    // Post-Phase-4 the public marketing landing surfaces a guest agent FAB
    // (marketingAgentSurface), but the agent panel must NOT auto-render before
    // any interaction — it stays unobtrusive until the visitor opens it.
    await expect(page.locator('.banking-agent-fab')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.banking-agent-panel')).toHaveCount(0);
  });
});

// ─── AUTHENTICATED tests ───────────────────────────────────────────────────────

test.describe('BankingAgent — Authenticated (customer logged in)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
    });
  });

  test('agent renders inline on the user dashboard (no floating FAB)', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, SAMPLE_ACCOUNTS);
    await page.goto('/dashboard');
    // Phase 4: middle placement is the default — the single agent auto-renders
    // inline inside the dashboard's middle column. There is no floating FAB.
    await expect(
      page.locator('.ud-dashboard-inline-agent-host .banking-agent-panel.ba-mode-inline')
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.banking-agent-fab')).toHaveCount(0);
  });

  test('inline agent panel uses split-column chrome on /dashboard', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    const panel = page.locator('.banking-agent-panel');
    await expect(panel).toHaveClass(/ba-mode-inline/);
    await expect(panel).toHaveClass(/ba-split-column/);
  });

  test('panel shows the inline assistant title on /dashboard', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    // Inline split-column chrome renders "{Brand} Assistant".
    // The brand name is theme-driven so match the suffix only.
    await expect(page.locator('.ba-title')).toContainText('Assistant');
  });

  test('subtitle shows customer role badge when logged in', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    await expect(page.locator('.ba-subtitle')).toContainText('Customer');
    await expect(page.locator('.ba-subtitle')).toContainText('Test');
  });

  test('welcome message area is shown for logged-in user', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    const messages = page.locator('.banking-agent-messages');
    await expect(messages).toBeVisible();
  });

  test('inline chrome surfaces a session sign-out control for the customer', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    // The old `.ba-left-col` "My Dashboard" nav button does not exist in inline
    // split-column chrome (the agent IS the dashboard surface there). The
    // equivalent signed-in affordance is the split-column header sign-out.
    await expect(
      page.locator('.banking-agent-panel .ba-header-signout', { hasText: 'Sign out' })
    ).toBeVisible();
  });

  // NOTE: Actions-popout coverage of core banking actions (My Accounts,
  // Recent Transactions, Check Balance, Deposit, Withdraw, Transfer — the old
  // "primary rail") was removed here (Task 9, actions-dropdown-removal). That
  // popout no longer exists; per the removal design, this content is now
  // reachable only via `/use-cases`, which has its own e2e coverage
  // (use-cases-catalog.spec.js, use-cases-live.spec.js, hitl-transfer.spec.js).

  test('login action buttons are NOT shown when user is authenticated', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await ensureAgentReady(page);
    // The popout / panel must not surface a sign-in affordance for an
    // already-authenticated customer.
    const panel = page.locator('.banking-agent-panel');
    await expect(panel).not.toContainText('Admin Sign In');
    await expect(panel).not.toContainText('Customer Sign In');
  });
});

// ─── ADMIN tests ───────────────────────────────────────────────────────────────

test.describe('BankingAgent — Authenticated (admin logged in)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
    });
  });

  // Admin uses Dashboard.js (no inline middle host), so the single agent stays
  // in floating chrome behind a `.banking-agent-fab`. ensureAgentReady() clicks
  // the FAB when present, then waits for the panel.

  test('agent panel opens from the FAB on /admin', async ({ page }) => {
    await mockAuthenticatedAdmin(page);
    await page.goto('/admin');
    await expect(page.locator('.banking-agent-fab')).toBeVisible({ timeout: 20000 });
    await ensureAgentReady(page);
    // Admin float chrome renders "{Brand} AI Agent".
    // The brand name is theme-driven so match the suffix only.
    await expect(page.locator('.ba-title')).toContainText('Agent');
  });

  test('subtitle shows admin role badge for admin user', async ({ page }) => {
    await mockAuthenticatedAdmin(page);
    await page.goto('/admin');
    await ensureAgentReady(page);
    await expect(page.locator('.ba-subtitle')).toContainText('Admin');
    await expect(page.locator('.ba-subtitle')).toContainText('Alice');
  });

  test('dashboard nav button shows "Admin Dashboard" for admin', async ({ page }) => {
    await mockAuthenticatedAdmin(page);
    await page.goto('/admin');
    await ensureAgentReady(page);
    await expect(
      page.locator('.banking-agent-panel .ba-left-auth-btn.primary', { hasText: 'Admin Dashboard' })
    ).toBeVisible();
  });

  test('admin-only tools are present in the Admin Tools popout', async ({ page }) => {
    await mockAuthenticatedAdmin(page);
    await page.goto('/admin');
    await ensureAgentReady(page);
    // The old Actions popout's "Admin Actions" / "PingOne Admin" sections were
    // replaced by the dedicated Admin ▾ popout (AdminToolsDropdown, Task 5);
    // assert a current admin-only entry is reachable there.
    await openAdminToolsPanel(page);
    await expect(page.locator('[data-testid="admin-tool-lookup_customer"]')).toBeVisible();
  });
});

// ─── AUTO-OPEN via ?oauth=success ─────────────────────────────────────────────

test.describe('BankingAgent — auto-open via ?oauth=success', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
    });
  });

  test('panel opens automatically when URL contains ?oauth=success', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard?oauth=success');
    await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });
  });

  test('?oauth=success param is removed from URL after auto-open', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard?oauth=success');
    await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });
    await expect(page).not.toHaveURL(/oauth=success/);
  });
});
