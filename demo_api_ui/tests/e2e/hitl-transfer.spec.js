/**
 * @file hitl-transfer.spec.js
 * Playwright E2E — transaction HITL consent modal + demo OTP 123123 (mocked API).
 */

const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');

const CHALLENGE_ID = 'ch_hitl_e2e_001';

test.describe('Transaction HITL consent (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('userLoggedOut');
      } catch (_) {}
    });

    await mockCustomerDashboard(page);

    await page.route('**/api/admin/feature-flags**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flags: [{ id: 'ff_hitl_enabled', value: true }],
        }),
      }),
    );

    let challengeConfirmed = false;

    await page.route('**/api/transactions/consent-challenge', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          challengeId: CHALLENGE_ID,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          snapshot: {
            type: body.type,
            amount: body.amount,
            fromAccountId: body.fromAccountId,
            toAccountId: body.toAccountId,
            description: body.description,
          },
        }),
      });
    });

    await page.route(`**/api/transactions/consent-challenge/${CHALLENGE_ID}`, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            challengeId: CHALLENGE_ID,
            snapshot: {
              type: 'transfer',
              amount: 300,
              fromAccountId: 'acc_001',
              toAccountId: 'acc_002',
              description: 'HITL E2E transfer',
            },
          }),
        });
      }
      return route.continue();
    });

    await page.route(`**/api/transactions/consent-challenge/${CHALLENGE_ID}/confirm`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          challengeId: CHALLENGE_ID,
          otpSent: true,
          otpExpiresAt: new Date(Date.now() + 300000).toISOString(),
          maskedContact: 't***@example.com',
        }),
      }),
    );

    await page.route(`**/api/transactions/consent-challenge/${CHALLENGE_ID}/verify-otp`, (route) => {
      challengeConfirmed = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, challengeId: CHALLENGE_ID }),
      });
    });

    await page.route('**/api/transactions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      if (body.consentChallengeId === CHALLENGE_ID && challengeConfirmed) {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'txn_hitl_ok', type: 'transfer', amount: body.amount }),
        });
      }
      return route.fulfill({
        status: 428,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'hitl_required',
          hitl: { type: 'consent' },
          ...body,
        }),
      });
    });
  });

  test('agent HITL event opens consent modal and completes with OTP 123123', async ({ page }) => {
    await page.goto('/dashboard');

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

    await expect(page.getByText('Transaction summary')).toBeVisible({ timeout: 15000 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree & continue' }).click();

    await expect(page.getByPlaceholder('123123')).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('123123').fill('123123');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText(/Consent verified/i)).toBeVisible({ timeout: 15000 });
  });
});
