/**
 * @file banking-agent.real.spec.js
 * @description Real-login Playwright E2E tests for the BankingAgent (Phase 4 UI).
 *
 * Phase 4 model:
 *   - Customer /dashboard: agent renders INLINE (portaled into
 *     `.ud-dashboard-inline-agent-host`) with `ba-mode-inline ba-split-column`.
 *     There is NO floating FAB on the customer dashboard.
 *   - Admin /admin: agent uses floating chrome behind `.banking-agent-fab`.
 *   - Banking actions live in an Actions popout: `button.ba-actions-trigger` →
 *     `.ba-actions-popout` → `button.ba-popout-list-item`.
 *
 * SKIPPED AUTOMATICALLY when credentials are not set.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
} = require('./helpers/realLogin');

// ─── Phase-4 helpers ──────────────────────────────────────────────────────────

/**
 * Wait for the single BankingAgent panel to be ready.
 *
 * Customer /dashboard: panel renders inline automatically — no FAB click needed.
 * Admin /admin: panel is behind a floating FAB — clicks it when present.
 */
async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  if (await panel.isVisible().catch(() => false)) return;
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

/**
 * Click a named action row inside the Actions popout.
 * Opens the popout idempotently and expands any collapsed section.
 */
async function agentPanelButton(page, namePattern) {
  const popout = page.locator('.ba-actions-popout');
  if (!(await popout.isVisible().catch(() => false))) {
    await page
      .locator('button.ba-actions-trigger', { hasText: /Actions/i })
      .first()
      .click();
    await expect(popout).toBeVisible({ timeout: 10000 });
  }
  const sections = popout.locator('.ba-popout-section');
  const sectionCount = await sections.count();
  for (let i = 0; i < sectionCount; i++) {
    const toggle = sections.nth(i).locator('.ba-popout-section-toggle');
    if (await toggle.count()) {
      const label = (await toggle.first().textContent()) || '';
      if (label.trim().startsWith('▶')) {
        await toggle.first().click();
      }
    }
  }
  return popout
    .locator('button.ba-popout-list-item')
    .filter({ has: page.locator('.ba-popout-item-name', { hasText: namePattern }) });
}

// ─── Customer real-login suite ────────────────────────────────────────────────

test.describe('BankingAgent — Real login (customer)', () => {
  test.skip(() => !requireRealLoginEnv(), 'Real-login tests skipped: E2E_CUSTOMER_USERNAME not set');

  test.beforeEach(async ({ page }) => {
    await loginAsCustomer(page);
    await page.evaluate(() =>
      fetch('/api/verticals/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'banking' }),
      })
    );
  });

  test('agent panel renders inline on dashboard after real OAuth login (no FAB)', async ({ page }) => {
    await expect(
      page.locator('.ud-dashboard-inline-agent-host .banking-agent-panel.ba-mode-inline')
    ).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.banking-agent-fab')).toHaveCount(0);
  });

  test('agent panel shows real user name in subtitle after login', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(page.locator('.ba-subtitle')).toBeVisible();
    await expect(page.locator('.ba-subtitle')).not.toContainText('Admin');
  });

  test('Sign In buttons are NOT shown when customer is authenticated', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(page.locator('.banking-agent-panel')).not.toContainText('Customer Sign In');
    await expect(page.locator('.banking-agent-panel')).not.toContainText('Admin Sign In');
  });

  test('consent-denied banner is NOT shown by default (no prior decline)', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test('core banking actions appear in the Actions popout', async ({ page }) => {
    await ensureAgentReady(page);
    for (const label of ['My Accounts', 'Recent Transactions', 'Check Balance', 'Deposit', 'Transfer']) {
      const row = await agentPanelButton(page, new RegExp(`^${label}$`));
      await expect(row).toHaveCount(1);
    }
  });

  test('My Accounts chip triggers real /api/mcp/tool call and shows account data', async ({ page }) => {
    await ensureAgentReady(page);

    const mcpRequest = page.waitForRequest(req =>
      req.url().includes('/api/mcp/tool') && req.method() === 'POST'
    );

    const row = await agentPanelButton(page, /^My Accounts$/);
    await row.click();
    const req = await mcpRequest;

    const body = req.postDataJSON();
    expect(body.tool).toBe('get_my_accounts');

    const messages = page.locator('.banking-agent-messages');
    await expect(messages).not.toBeEmpty({ timeout: 30000 });

    const text = await messages.textContent();
    expect(text).not.toMatch(/at Object\.|TypeError:|Cannot read/);
  });

  test('Recent Transactions chip triggers real API call', async ({ page }) => {
    await ensureAgentReady(page);

    const mcpRequest = page.waitForRequest(req =>
      req.url().includes('/api/mcp/tool') && req.method() === 'POST'
    );

    const row = await agentPanelButton(page, /^Recent Transactions$/);
    await row.click();
    const req = await mcpRequest;
    const body = req.postDataJSON();
    expect(body.tool).toBe('get_my_transactions');

    const messages = page.locator('.banking-agent-messages');
    await expect(messages).not.toBeEmpty({ timeout: 30000 });
    const text = await messages.textContent();
    expect(text).not.toMatch(/at Object\.|TypeError:/);
  });

  test('Check Balance chip closes popout and dispatches action', async ({ page }) => {
    await ensureAgentReady(page);
    const row = await agentPanelButton(page, /^Check Balance$/);
    await row.click();
    await expect(page.locator('.ba-actions-popout')).toBeHidden();
    await expect(page.locator('.banking-agent-messages')).toContainText('Check Balance', { timeout: 15000 });
  });

  test('Deposit chip closes popout and dispatches action', async ({ page }) => {
    await ensureAgentReady(page);
    const row = await agentPanelButton(page, /^Deposit$/);
    await row.click();
    await expect(page.locator('.ba-actions-popout')).toBeHidden();
    await expect(page.locator('.banking-agent-messages')).toContainText('Deposit', { timeout: 15000 });
  });

  test('Transfer chip closes popout and dispatches action', async ({ page }) => {
    await ensureAgentReady(page);
    const row = await agentPanelButton(page, /^Transfer$/);
    await row.click();
    await expect(page.locator('.ba-actions-popout')).toBeHidden();
    await expect(page.locator('.banking-agent-messages')).toContainText('Transfer', { timeout: 15000 });
  });
});

// ─── Admin real-login suite ───────────────────────────────────────────────────

test.describe('BankingAgent — Real login (admin)', () => {
  test.skip(() => !requireAdminLoginEnv(), 'Real admin tests skipped: E2E_ADMIN_USERNAME not set');

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.evaluate(() =>
      fetch('/api/verticals/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'banking' }),
      })
    );
  });

  test('admin panel is accessible on /admin', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(page.locator('.ba-title')).toContainText('Agent');
  });

  test('admin panel shows Admin role badge in subtitle', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(page.locator('.ba-subtitle')).toContainText('Admin');
  });

  test('admin sees Admin Dashboard button in panel nav', async ({ page }) => {
    await ensureAgentReady(page);
    await expect(
      page.locator('.banking-agent-panel .ba-left-auth-btn.primary', { hasText: 'Admin Dashboard' })
    ).toBeVisible();
  });

  test('admin-only actions are present in the Actions popout', async ({ page }) => {
    await ensureAgentReady(page);
    const row = await agentPanelButton(page, /Query User by Email/i);
    await expect(row).toHaveCount(1);
  });
});
