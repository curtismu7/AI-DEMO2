/**
 * @file hitl-transfer.real.spec.js
 * Real-login Playwright E2E for transaction HITL consent + OTP 123123.
 *
 * Prerequisites:
 *   - Stack running (./run.sh): UI :4000, BFF https://api.ping.demo:3001
 *   - E2E_CUSTOMER_USERNAME + E2E_CUSTOMER_PASSWORD in tests/e2e/.env.e2e
 *
 * Run:
 *   cd demo_api_ui
 *   E2E_BASE_URL=http://localhost:4000 PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e:hitl:real
 */

const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { completeConsentModalWithOtp } = require('./helpers/hitlMocks');

test.describe('Transaction HITL consent (real login)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test('agent HITL event completes consent with demo OTP 123123', async ({ page }) => {
    await loginAsCustomer(page);

    const accounts = await page.evaluate(async () => {
      const r = await fetch('/api/accounts/my', { credentials: 'include' });
      if (!r.ok) throw new Error(`accounts/my -> ${r.status}`);
      const data = await r.json();
      return data.accounts || [];
    });

    const normalize = (v) => String(v || '').trim().toLowerCase();
    const checking = accounts.find((a) => normalize(a.accountType ?? a.account_type) === 'checking');
    const savings = accounts.find((a) => normalize(a.accountType ?? a.account_type) === 'savings');
    test.skip(!checking?.id || !savings?.id, 'Need checking and savings accounts');

    await page.evaluate(
      ({ fromId, toId }) => {
        window.dispatchEvent(
          new CustomEvent('banking-agent-hitl-consent', {
            detail: {
              intentPayload: {
                type: 'transfer',
                fromAccountId: fromId,
                toAccountId: toId,
                amount: 300,
                description: 'HITL real E2E transfer',
              },
            },
          }),
        );
      },
      { fromId: checking.id, toId: savings.id },
    );

    await completeConsentModalWithOtp(page);
  });

  test('dashboard transfer completes HITL consent with demo OTP 123123', async ({ page }) => {
    await loginAsCustomer(page);

    const transferBtn = page.locator('.account-card').first().getByRole('button', { name: 'Transfer' });
    const hasCards = await transferBtn.isVisible({ timeout: 15000 }).catch(() => false);
    test.skip(!hasCards, 'Dashboard layout does not show account-card Transfer buttons');

    await transferBtn.click();
    await expect(page.getByRole('heading', { name: 'Transfer Money' })).toBeVisible({ timeout: 15000 });

    const form = page.locator('.transfer-form');
    await form.locator('select').selectOption({ index: 1 });
    await form.getByPlaceholder('Enter amount').fill('300');
    await form.locator('.transfer-btn').click();

    await completeConsentModalWithOtp(page);
    await expect(page.getByRole('heading', { name: 'Transfer Money' })).toBeHidden({ timeout: 30000 });
  });
});
