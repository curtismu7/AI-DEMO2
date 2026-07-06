/**
 * @file hitl-agui-interrupt.spec.js
 * Playwright E2E — AG-UI RUN_FINISHED interrupt shows GatewayConsentModal (mocked).
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

const INTERRUPT_SSE =
  'data: {"type":"RUN_FINISHED","runId":"run-int-1","threadId":"thread-int-1","outcome":{"type":"interrupt","interrupts":[{"id":"int-agui-1","reason":"consent_required"}]}}\n\n';

/** Mock authenticated customer session and AG-UI feature flag. */
async function mockAguiCustomer(page) {
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
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }),
    }),
  );
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accounts: [
          { id: 'acc_001', accountType: 'checking', balance: 1500, accountNumber: 'CHK-001' },
        ],
      }),
    }),
  );
  await page.route('**/api/transactions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transactions: [] }),
    }),
  );
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        flags: [
          { id: 'ff_agui_enabled', value: true },
          { id: 'ff_hitl_enabled', value: true },
        ],
      }),
    }),
  );
  await page.route('**/api/tokens/session-preview**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tokenEvents: [] }),
    }),
  );
  await page.route('**/api/verticals/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  await page.route('**/api/config/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  await page.route('**/ws**', (route) => route.abort());
}

test.describe('AG-UI HITL interrupt (mocked)', () => {
  test('RUN_FINISHED interrupt opens GatewayConsentModal', async ({ page }) => {
    await mockAguiCustomer(page);

    await page.route('**/api/agent/run', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: INTERRUPT_SSE,
      });
    });

    await page.route('**/api/agent/consent/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, approved: true }),
      }),
    );

    await page.goto('/dashboard');

    const agentInput = page.locator('input.ba-input');
    await expect(agentInput).toBeVisible({ timeout: 20000 });
    await agentInput.fill('Transfer $600 to savings');
    await agentInput.press('Enter');

    await expect(page.getByText('Action Requires Your Approval')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Human-in-the-Loop')).toBeVisible();
  });
});
