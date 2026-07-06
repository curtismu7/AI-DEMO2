/**
 * @file hitl-transfer.spec.js
 * Playwright E2E — transaction HITL consent modal + demo OTP 123123 (mocked API).
 */

const { test, expect } = require('@playwright/test');
const {
  mockHitlDashboard,
  mockHitlConsentApi,
  completeConsentModalWithOtp,
  ensureInlineAgent,
  openDashboardTransferForm,
  submitDashboardTransfer,
} = require('./helpers/hitlMocks');

test.describe('Transaction HITL consent (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('userLoggedOut');
      } catch (_) {}
    });
    await mockHitlDashboard(page);
    await mockHitlConsentApi(page);
  });

  test('agent HITL event opens consent modal and completes with OTP 123123', async ({ page }) => {
    await page.goto('/dashboard');
    await ensureInlineAgent(page);

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('banking-agent-hitl-consent', {
          detail: {
            intentPayload: {
              type: 'transfer',
              fromAccountId: 'acc_001',
              toAccountId: 'acc_002',
              amount: 300,
              description: 'HITL E2E transfer',
            },
          },
        }),
      );
    });

    await completeConsentModalWithOtp(page);
  });

  test('dashboard transfer form triggers HITL consent and completes with OTP 123123', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 20000 });

    await openDashboardTransferForm(page);
    await submitDashboardTransfer(page, { amount: '300' });

    await completeConsentModalWithOtp(page);
    await expect(page.getByRole('heading', { name: 'Transfer Money' })).toBeHidden({ timeout: 15000 });
  });
});
