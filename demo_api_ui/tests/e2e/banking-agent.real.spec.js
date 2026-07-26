/**
 * @file banking-agent.real.spec.js
 * @description Real-login Playwright E2E tests for the BankingAgent (Phase 4 UI).
 *
 * Phase 4 model:
 *   - Customer /dashboard: agent renders INLINE (portaled into
 *     `.ud-dashboard-inline-agent-host`) with `ba-mode-inline ba-split-column`.
 *     There is NO floating FAB on the customer dashboard.
 *   - Admin /admin: agent uses floating chrome behind `.banking-agent-fab`.
 *   - The old Actions popout (`button.ba-actions-trigger` → `.ba-actions-popout`
 *     → `button.ba-popout-list-item`) was removed entirely. Core banking
 *     actions are now reachable only via `/use-cases` (own e2e coverage).
 *     Admin-only ops moved to the `Admin ▾` popout
 *     (`[data-testid="admin-tools-trigger"]`, `AdminToolsDropdown`).
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

  // NOTE: Actions-popout coverage of core banking actions (My Accounts, Recent
  // Transactions, Check Balance, Deposit, Transfer — the old "primary rail")
  // was removed here (Task 9, actions-dropdown-removal). That popout no
  // longer exists; per the removal design, this content is now reachable only
  // via `/use-cases`, which has its own e2e coverage.
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

  test('admin-only tools are present in the Admin Tools popout', async ({ page }) => {
    await ensureAgentReady(page);
    await openAdminToolsPanel(page);
    await expect(page.locator('[data-testid="admin-tool-lookup_customer"]')).toBeVisible();
  });
});
