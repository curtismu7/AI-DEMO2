/**
 * @file chip-themes.spec.js
 * E2E tests: BankingChips renders the correct labels for every vertical theme,
 * and clicking a chip fires the expected NL message.
 *
 * Strategy:
 *  - Mock /api/config/vertical to return each vertical's manifest so
 *    ThemeContext.applyChipLabels() overlays the correct labels.
 *  - Mock every other BFF endpoint so no live server is needed.
 *  - Open /dashboard as a logged-in customer.
 *  - Open the agent's "Actions" popout, then expand the BankingChips panel
 *    and assert the Quick Actions chip labels match the manifest.
 *  - For one chip per vertical, assert the NL POST body carries the invariant
 *    routing message (not the display label).
 *
 * Verticals under test: banking, healthcare, retail, sporting-goods, workforce
 * (admin vertical has no customer-facing chip overlay — skipped here).
 *
 * No live API server or PingOne is required.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ── Vertical configs (ground truth for expected labels) ───────────────────────

/**
 * Load a vertical JSON from the server config directory.
 * Returns the parsed manifest object.
 */
function loadVertical(id) {
  const p = path.resolve(
    __dirname,
    '../../../demo_api_server/config/verticals',
    id,
    'manifest.json',
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const VERTICALS = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce', 'government', 'university', 'manufacturing'];

/**
 * Map of invariant routing messages for each heuristic chip id.
 * These must never change — they are the skip-proof routing keys.
 */
const INVARIANT_MESSAGES = {
  balance:     'balance',
  accounts:    'accounts',
  transactions:'transactions',
  transfer:    'transfer',
  feature:     'show vertical feature',
};

// ── Fixtures ───────────────────────────────────────────────────────────────────

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
    { id: 'acc_001', name: 'Primary Checking', accountNumber: 'CHK-001', accountType: 'checking', balance: 1500.0 },
    { id: 'acc_002', name: 'Savings',          accountNumber: 'SAV-002', accountType: 'savings',  balance: 8200.5 },
  ],
};

const SAMPLE_TRANSACTIONS = {
  transactions: [
    { id: 'txn_1', type: 'deposit',    amount: 500, description: 'Payroll', createdAt: '2026-03-01T10:00:00.000Z', accountInfo: 'Checking', clientType: 'enduser', performedBy: 'Test User' },
    { id: 'txn_2', type: 'withdrawal', amount: 100, description: 'ATM',     createdAt: '2026-03-05T14:30:00.000Z', accountInfo: 'Checking', clientType: 'enduser', performedBy: 'Test User' },
  ],
};

const EMPTY_TOKEN_EVENTS = { tokenEvents: [] };

// ── Mock helpers ───────────────────────────────────────────────────────────────

/**
 * Install all required BFF mocks for a logged-in customer, injecting `manifest`
 * into /api/config/vertical so ThemeContext picks up the vertical's chip labels.
 */
async function mockCustomerWithVertical(page, manifest) {
  // OAuth — customer logged in via user/status endpoint
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) }),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }),
  );
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }),
  );

  // Vertical manifest — THIS is what drives the chip label overlay
  await page.route('**/api/config/vertical', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ manifest }) }),
  );

  // Data APIs
  await page.route('**/api/accounts/my**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_ACCOUNTS) }),
  );
  await page.route('**/api/transactions/my**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_TRANSACTIONS) }),
  );

  // Config / flags
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ config: {} }) }),
  );
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [{ id: 'ff_show_banking_in_middle_agent', value: true }] }) }),
  );
  await page.route('**/api/admin/app-events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );

  // Token chain / session preview
  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_TOKEN_EVENTS) }),
  );
  await page.route('**/api/token-chain**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_TOKEN_EVENTS) }),
  );

  // PingOne connectivity
  await page.route('**/api/pingone-test/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );

  // Silence WebSocket / MCP connections
  await page.route('**/ws**', (route) => route.abort());
}

/**
 * Wait for the inline BankingAgent panel to appear and be ready.
 * Customer /dashboard renders the agent inline (no FAB).
 */
async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
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
 * Open the Actions popout if not already open, then navigate to the
 * BankingChips area (Quick Actions section).
 *
 * The chips live inside `.banking-chips-content` which is rendered inside
 * the agent panel — it may be directly visible or inside the Actions popout
 * depending on the agent chrome mode.
 */
async function openChipsPanel(page) {
  // Try the Actions trigger first (popout-mode chrome)
  const trigger = page.locator('button.ba-actions-trigger').first();
  if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    const popout = page.locator('.ba-actions-popout');
    if (!(await popout.isVisible().catch(() => false))) {
      await trigger.click();
      await expect(popout).toBeVisible({ timeout: 10000 });
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Chip labels per vertical theme', () => {

  for (const verticalId of VERTICALS) {
    const manifest = loadVertical(verticalId);
    const manifestChips = (manifest.dashboard && manifest.dashboard.chips) || [];

    // Build expected label map from the manifest
    const expectedLabels = {};
    for (const c of manifestChips) {
      if (INVARIANT_MESSAGES[c.key] !== undefined) {
        expectedLabels[c.key] = c.label;
      }
    }

    test.describe(`Vertical: ${verticalId}`, () => {

      test(`[${verticalId}] Quick Action chips show manifest labels`, async ({ page }) => {
        await mockCustomerWithVertical(page, manifest);
        await page.goto('/dashboard');
        await ensureAgentReady(page);
        await openChipsPanel(page);

        // The BankingChips "Quick Actions" section renders heuristic chips
        const chipsSection = page.locator('.banking-chips-dropdown__section')
          .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
        await expect(chipsSection).toBeVisible({ timeout: 15000 });

        for (const [key, label] of Object.entries(expectedLabels)) {
          const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label });
          await expect(
            chipBtn.first(),
            `[${verticalId}] chip key="${key}" should have label "${label}"`,
          ).toBeVisible({ timeout: 10000 });
        }
      });

      // For each chip key with a known invariant message, verify the click
      // sends the invariant routing message (not the display label).
      for (const [key, invariantMessage] of Object.entries(INVARIANT_MESSAGES)) {
        const label = expectedLabels[key];
        if (!label) continue; // vertical doesn't define this chip key — skip

        test(`[${verticalId}] clicking "${label}" (key=${key}) sends invariant message "${invariantMessage}"`, async ({ page }) => {
          const nlRequests = [];

          await mockCustomerWithVertical(page, manifest);

          // Intercept NL calls — capture request body before fulfilling
          await page.route('**/api/demo-agent/nl', async (route) => {
            const body = route.request().postDataJSON();
            nlRequests.push(body);
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                source: 'heuristic',
                kind: 'banking',
                action: 'get_my_accounts',
                result: { accounts: [] },
                executed: true,
                tokenEvents: [],
              }),
            });
          });

          // Also stub MCP tool so any follow-up MCP call doesn't error
          await page.route('**/api/mcp/tool', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json',
              body: JSON.stringify({ result: { accounts: [] } }) }),
          );

          await page.goto('/dashboard');
          await ensureAgentReady(page);
          await openChipsPanel(page);

          const chipsSection = page.locator('.banking-chips-dropdown__section')
            .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
          await expect(chipsSection).toBeVisible({ timeout: 15000 });

          const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label }).first();
          await expect(chipBtn).toBeVisible({ timeout: 10000 });
          await chipBtn.click();

          // Wait for the NL request to arrive
          await page.waitForTimeout(2000);

          expect(
            nlRequests.length,
            `[${verticalId}] clicking chip "${label}" should POST to /api/demo-agent/nl`,
          ).toBeGreaterThan(0);

          const lastReq = nlRequests[nlRequests.length - 1];
          expect(
            lastReq.message,
            `[${verticalId}] chip key="${key}" must send invariant message (not display label)`,
          ).toBe(invariantMessage);
        });
      }
    });
  }
});
