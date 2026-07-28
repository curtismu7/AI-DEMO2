/**
 * @file hitlMocks.js
 * Shared Playwright mocks for HITL UI E2E specs (mocked + real-login helpers).
 */

const { expect } = require('@playwright/test');
const { mockCustomerDashboard, SAMPLE_ACCOUNTS } = require('./customerDashboardMocks');

/** Feature flags required for dashboard + inline agent + HITL flows. */
const HITL_DASHBOARD_FLAGS = [
  { id: 'ff_show_agent_in_middle', value: true },
  { id: 'ff_customer_skin_ping2026', value: false },
  { id: 'ff_agent_clinical_split', value: false },
  { id: 'ff_hitl_enabled', value: true },
];

const HITL_AGUI_FLAGS = [{ id: 'ff_agui_enabled', value: true }];

/** Stub agent bootstrap routes so mocked E2E does not proxy to an offline BFF. */
async function stubAgentBootstrapRoutes(page) {
  const json = (body = {}) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  const stubs = [
    ['**/api/verticals/stream**', json({ verticals: [] })],
    ['**/api/verticals/me**', json({ vertical: null })],
    ['**/api/verticals/list**', json({ verticals: [] })],
    ['**/api/langchain/config/status**', json({ configured: false })],
    ['**/api/langchain/provider/llamacpp/status**', json({ available: false })],
    ['**/api/auth/ciba/status**', json({ enabled: false })],
    ['**/api/health/demo-status**', json({ ok: true })],
    ['**/api/authorize/warmup**', json({ ok: true })],
    ['**/api/demo-agent/tools**', json({ tools: [] })],
    ['**/api/demo-agent/nl/status**', json({ ready: false })],
    ['**/api/conversations/me/banking/summaries**', json({ summaries: [] })],
    ['**/api/mcp/tool/events**', json({ events: [] })],
  ];

  for (const [pattern, response] of stubs) {
    await page.route(pattern, (route) => route.fulfill(response));
  }
}

/** Install dashboard mocks plus HITL-related feature flags. */
async function mockHitlDashboard(page, { agui = false } = {}) {
  await mockCustomerDashboard(page);
  await stubAgentBootstrapRoutes(page);

  const flags = agui
    ? [...HITL_DASHBOARD_FLAGS, ...HITL_AGUI_FLAGS]
    : HITL_DASHBOARD_FLAGS;

  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags }),
    }),
  );
}

/** Mock consent-challenge + POST /api/transactions HITL gate (does not intercept consent paths). */
async function mockHitlConsentApi(page, challengeId = 'ch_hitl_e2e_001') {
  let challengeConfirmed = false;

  await page.route('**/api/transactions/consent-challenge', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        challengeId,
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

  await page.route(`**/api/transactions/consent-challenge/${challengeId}`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          challengeId,
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

  await page.route(`**/api/transactions/consent-challenge/${challengeId}/confirm`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        challengeId,
        otpSent: true,
        otpExpiresAt: new Date(Date.now() + 300000).toISOString(),
        maskedContact: 't***@example.com',
      }),
    }),
  );

  await page.route(`**/api/transactions/consent-challenge/${challengeId}/verify-otp`, (route) => {
    challengeConfirmed = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, challengeId }),
    });
  });

  await page.route('**/api/transactions', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/transactions') return route.continue();
    if (route.request().method() !== 'POST') return route.continue();

    const body = route.request().postDataJSON();
    if (body.consentChallengeId === challengeId && challengeConfirmed) {
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

  return { challengeId, isConfirmed: () => challengeConfirmed };
}

/** Wait for inline BankingAgent on /dashboard. */
async function ensureInlineAgent(page) {
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

/** Assert a react-toastify message (avoids strict-mode collisions with agent chat). */
async function expectToast(page, pattern, timeout = 15000) {
  const toast = page.locator('.Toastify__toast-body').filter({ hasText: pattern }).first();
  await expect(toast).toBeVisible({ timeout });
}

/** Open the dashboard transfer form from the first account card. */
async function openDashboardTransferForm(page) {
  await page.locator('.account-card').first().getByRole('button', { name: 'Transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer Money' })).toBeVisible({ timeout: 15000 });
}

/** Fill and submit the inline dashboard transfer form (labels are not wired with htmlFor). */
async function submitDashboardTransfer(page, { amount = '300' } = {}) {
  const form = page.locator('.transfer-form');
  await form.locator('select').selectOption({ index: 1 });
  await form.getByPlaceholder('Enter amount').fill(amount);
  await form.locator('.transfer-btn').click();
}

/** Complete the TransactionConsentModal through OTP 123123. */
async function completeConsentModalWithOtp(page) {
  const dialog = page.locator('.transaction-consent-popup');
  await expect(dialog.getByText('Transfer')).toBeVisible({ timeout: 15000 });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Agree & continue' }).click();
  await expect(page.getByPlaceholder('123123')).toBeVisible({ timeout: 15000 });
  await page.getByPlaceholder('123123').fill('123123');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
}

module.exports = {
  HITL_DASHBOARD_FLAGS,
  SAMPLE_ACCOUNTS,
  mockHitlDashboard,
  mockHitlConsentApi,
  ensureInlineAgent,
  expectToast,
  openDashboardTransferForm,
  submitDashboardTransfer,
  completeConsentModalWithOtp,
};
