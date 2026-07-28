/**
 * @file hitl-transfer.real.spec.js
 * Real-login Playwright E2E for transaction HITL consent + OTP 123123.
 * Captures screenshots at each step for verification reports.
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
const path = require('path');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { completeConsentModalWithOtp } = require('./helpers/hitlMocks');

const SHOT_DIR = path.join(__dirname, 'screenshots');

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test.describe('Transaction HITL consent (real login)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test('agent HITL event completes consent with demo OTP 123123', async ({ page }) => {
    await loginAsCustomer(page);
    await shot(page, '01-after-login');

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

    const dialog = page.locator('.transaction-consent-popup');
    await expect(dialog.getByText('Transfer')).toBeVisible({ timeout: 15000 });
    await shot(page, '02-consent-modal-open');

    await dialog.getByRole('checkbox').check();
    await shot(page, '03-consent-agreed');

    await dialog.getByRole('button', { name: 'Agree & continue' }).click();
    await expect(page.getByPlaceholder('123123')).toBeVisible({ timeout: 15000 });
    await shot(page, '04-otp-prompt');

    await page.getByPlaceholder('123123').fill('123123');
    await shot(page, '05-otp-entered');

    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await shot(page, '06-consent-verified');
  });

  test('dashboard transfer completes HITL consent with demo OTP 123123', async ({ page }) => {
    await loginAsCustomer(page);
    await shot(page, '07-dashboard-after-login');

    const transferBtn = page.locator('.account-card').first().getByRole('button', { name: 'Transfer' });
    const hasCards = await transferBtn.isVisible({ timeout: 15000 }).catch(() => false);
    test.skip(!hasCards, 'Dashboard layout does not show account-card Transfer buttons');

    await transferBtn.click();
    await expect(page.getByRole('heading', { name: 'Transfer Money' })).toBeVisible({ timeout: 15000 });
    await shot(page, '08-transfer-form-open');

    const form = page.locator('.transfer-form');
    await form.locator('select').selectOption({ index: 1 });
    await form.getByPlaceholder('Enter amount').fill('300');
    await shot(page, '09-transfer-form-filled');

    await form.locator('.transfer-btn').click();
    await shot(page, '10-after-transfer-submit');

    const dialog = page.locator('.transaction-consent-popup');
    await expect(dialog.getByText('Transfer')).toBeVisible({ timeout: 15000 });
    await shot(page, '11-dashboard-consent-modal');

    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Agree & continue' }).click();
    await expect(page.getByPlaceholder('123123')).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('123123').fill('123123');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeHidden({ timeout: 30000 });
    await shot(page, '12-dashboard-consent-verified');
  });
});
