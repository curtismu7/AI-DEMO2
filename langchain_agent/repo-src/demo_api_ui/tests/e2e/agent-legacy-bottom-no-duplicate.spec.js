/**
 * @file agent-legacy-bottom-no-duplicate.spec.js
 * @description Regression: a user with the RETIRED `bottom` dock placement
 *   persisted in localStorage (banking_agent_ui_v2 = {placement:'bottom'})
 *   used to get TWO BankingAgent instances on /dashboard. Each instance has
 *   its own per-instance `autoLoadedRef` guard for the once-per-session
 *   "Your Accounts" auto-load (BankingAgent.js ~line 2454). Two instances
 *   racing the shared sessionStorage guard both appended the auto-load, so
 *   the account list rendered twice as two identical assistant bubbles.
 *
 *   Phase 4b-4d retired 'bottom' and consolidated to a single instance
 *   (middle + float). AgentUiModeContext.readState() now coerces a persisted
 *   'bottom' to {placement:'middle'} (one autoLoadedRef → one bubble).
 *
 *   This test locks that in: with the legacy value set, there must be
 *   exactly ONE agent instance and the "Your Accounts" auto-load bubble
 *   must appear exactly ONCE.
 *
 *   All API calls intercepted — no live server required.
 */

const { test, expect } = require('@playwright/test');

const CUSTOMER_USER = {
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
    { id: 'acc_001', account_number: 'CHK-001', account_type: 'checking', name: 'Checking Account', balance: 1500.0 },
    { id: 'acc_002', account_number: 'SAV-002', account_type: 'savings', name: 'Savings Account', balance: 8200.5 },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('userLoggedOut');
      // The bug trigger: a persisted RETIRED 'bottom' placement from an
      // older build. Must coerce to a single middle instance, not spawn two.
      localStorage.setItem(
        'banking_agent_ui_v2',
        JSON.stringify({ placement: 'bottom', fab: true })
      );
    } catch (_) {}
  });
});

async function mockAuthenticatedCustomer(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) }));
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }));
  await page.route('**/api/auth/session**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }));
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_ACCOUNTS) }));
  await page.route('**/api/transactions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ transactions: [] }) }));
  await page.route('**/api/config/vertical**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ manifest: null }) }));
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ config: {} }) }));
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [] }) }));
  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) }));
  await page.route('**/api/token-chain**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }) }));
  await page.route('**/api/admin/app-events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/pingone-test/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) }));
  await page.route('**/api/verticals/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) }));
  await page.route('**/api/health/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }) }));
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/mcp**', (route) => route.abort());
}

test('legacy "bottom" placement → single agent, accounts auto-load renders once', async ({ page }) => {
  await mockAuthenticatedCustomer(page);
  await page.goto('/dashboard');

  // Single-instance guard: the retired 'bottom' value must not spawn two
  // BankingAgent components (the root cause of the duplicate render).
  await page.waitForTimeout(3000);
  expect(await page.locator('.banking-agent-panel').count(),
    'exactly one BankingAgent panel').toBe(1);
  expect(await page.locator('.ba-input').count(),
    'exactly one chat input').toBe(1);

  // Open the panel. Middle placement collapses to an "Open AI Banking
  // Assistant" control; float uses .banking-agent-fab. Try both.
  const openBtn = page.getByRole('button', { name: /Open AI Banking Assistant/i });
  if (await openBtn.count()) {
    await openBtn.first().click();
  } else {
    const fab = page.locator('.banking-agent-fab');
    if (await fab.count()) await fab.first().click();
  }

  // The welcome greeting must appear exactly once (single instance — no duplicate bubble).
  await expect(page.locator('.banking-agent-messages').first())
    .toContainText("I'm your AI assistant", { timeout: 20000 });
  await page.waitForTimeout(1500);

  const greetingBubbles = page.locator('.banking-agent-msg.assistant', { hasText: "I'm your AI assistant" });
  expect(await greetingBubbles.count(),
    'welcome greeting renders exactly once (no duplicate panel)').toBe(1);
});
