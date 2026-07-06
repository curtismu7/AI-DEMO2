/**
 * @file hitl-agui-interrupt.spec.js
 * Playwright E2E — AG-UI RUN_FINISHED interrupt shows GatewayConsentModal (mocked).
 */

const { test, expect } = require('@playwright/test');
const { mockHitlDashboard, ensureInlineAgent } = require('./helpers/hitlMocks');

const INTERRUPT_SSE =
  'data: {"type":"RUN_FINISHED","runId":"run-int-1","threadId":"thread-int-1","outcome":{"type":"interrupt","interrupts":[{"id":"int-agui-1","reason":"consent_required"}]}}\n\n';

test.describe('AG-UI HITL interrupt (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('userLoggedOut');
      } catch (_) {}
    });
    await mockHitlDashboard(page, { agui: true });

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
  });

  test('RUN_FINISHED interrupt opens GatewayConsentModal', async ({ page }) => {
    await page.goto('/dashboard');
    await ensureInlineAgent(page);

    const agentInput = page.locator('input.ba-input');
    await expect(agentInput).toBeVisible({ timeout: 20000 });
    await agentInput.fill('Transfer $600 to savings');
    await agentInput.press('Enter');

    await expect(page.getByText('Action Requires Your Approval')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Human-in-the-Loop')).toBeVisible();
  });
});
