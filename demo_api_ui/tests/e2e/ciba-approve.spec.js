/**
 * @file ciba-approve.spec.js
 * @description Playwright E2E smoke for the CIBA Approval page (/ciba-approve).
 *
 * UC22: separate-device out-of-band approval. This page is opened in a new tab
 * by the agent when a CIBA request starts. It is a bare-chrome public route
 * (no AppShell, no auth required).
 *
 * Covers:
 *   - No authReqId param → error state
 *   - Valid authReqId → pending state with Approve / Deny buttons
 *   - Transfer details rendered (amount, accounts)
 *   - Binding message rendered when no transfer details
 *   - Clicking Approve POSTs to /api/auth/ciba/approve-now/:id and shows confirmed
 *   - Clicking Deny POSTs to /api/auth/ciba/deny/:id and shows denied
 *   - 410 response → expired state
 *   - Non-OK response → error state
 *   - Modal title "PingOne Identity Verification" is shown
 *
 * All network calls are intercepted — no live server required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/ciba-approve.spec.js
 */

const { test, expect } = require('@playwright/test');

const AUTH_REQ_ID = 'test-auth-req-123';

const TRANSFER_DETAILS = {
  amount: 500,
  from_account_label: 'Checking ••4321',
  to_account_label: 'Savings ••8765',
  binding_message: 'Transfer approval',
};

const BINDING_DETAILS = {
  binding_message: 'Approve sign-in from Banking Agent',
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockCibaPending(page, details = TRANSFER_DETAILS) {
  await page.route(`**/api/auth/ciba/request/${AUTH_REQ_ID}`, (route) =>
    route.fulfill(json(details))
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('CIBA Approval page — modal title', () => {
  test('shows "PingOne Identity Verification" modal title', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByText('PingOne Identity Verification')).toBeVisible({ timeout: 10000 });
  });

  test('page root has data-testid="ciba-approve-page"', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByTestId('ciba-approve-page')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('CIBA Approval page — no authReqId', () => {
  test('shows error message when authReqId is missing', async ({ page }) => {
    await page.goto('/ciba-approve');
    await expect(
      page.getByText(/Could not load this approval request/)
    ).toBeVisible({ timeout: 10000 });
  });

  test('Approve button is NOT shown when authReqId is missing', async ({ page }) => {
    await page.goto('/ciba-approve');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('button', { name: 'Approve' })).not.toBeVisible();
  });
});

test.describe('CIBA Approval page — pending state', () => {
  test('shows approval prompt text', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(
      page.getByText('A sign-in attempt needs your approval.')
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows Approve button', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Deny button', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible({ timeout: 10000 });
  });

  test('shows transfer amount', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByText(/500\.00/)).toBeVisible({ timeout: 10000 });
  });

  test('shows from account label', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByText('Checking ••4321')).toBeVisible({ timeout: 10000 });
  });

  test('shows to account label', async ({ page }) => {
    await mockCibaPending(page);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(page.getByText('Savings ••8765')).toBeVisible({ timeout: 10000 });
  });

  test('shows binding_message when no transfer amount', async ({ page }) => {
    await mockCibaPending(page, BINDING_DETAILS);
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(
      page.getByText('Approve sign-in from Banking Agent')
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('CIBA Approval page — approve flow', () => {
  test('clicking Approve POSTs to approve-now endpoint', async ({ page }) => {
    await mockCibaPending(page);
    let approveCalled = false;
    await page.route(`**/api/auth/ciba/approve-now/${AUTH_REQ_ID}`, (route) => {
      approveCalled = true;
      return route.fulfill(json({ ok: true }));
    });
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForTimeout(500);
    expect(approveCalled).toBe(true);
  });

  test('after Approve shows confirmation message', async ({ page }) => {
    await mockCibaPending(page);
    await page.route(`**/api/auth/ciba/approve-now/${AUTH_REQ_ID}`, (route) =>
      route.fulfill(json({ ok: true }))
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved/)).toBeVisible({ timeout: 5000 });
  });

  test('Approve/Deny buttons disappear after Approve', async ({ page }) => {
    await mockCibaPending(page);
    await page.route(`**/api/auth/ciba/approve-now/${AUTH_REQ_ID}`, (route) =>
      route.fulfill(json({ ok: true }))
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('CIBA Approval page — deny flow', () => {
  test('clicking Deny POSTs to deny endpoint', async ({ page }) => {
    await mockCibaPending(page);
    let denyCalled = false;
    await page.route(`**/api/auth/ciba/deny/${AUTH_REQ_ID}`, (route) => {
      denyCalled = true;
      return route.fulfill(json({ ok: true }));
    });
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.getByRole('button', { name: 'Deny' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Deny' }).click();
    await page.waitForTimeout(500);
    expect(denyCalled).toBe(true);
  });

  test('after Deny shows denied message', async ({ page }) => {
    await mockCibaPending(page);
    await page.route(`**/api/auth/ciba/deny/${AUTH_REQ_ID}`, (route) =>
      route.fulfill(json({ ok: true }))
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.getByRole('button', { name: 'Deny' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText(/Denied/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('CIBA Approval page — error states', () => {
  test('410 response shows expired message', async ({ page }) => {
    await page.route(`**/api/auth/ciba/request/${AUTH_REQ_ID}`, (route) =>
      route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({}) })
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(
      page.getByText(/approval request has expired/)
    ).toBeVisible({ timeout: 10000 });
  });

  test('500 response shows error message', async ({ page }) => {
    await page.route(`**/api/auth/ciba/request/${AUTH_REQ_ID}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) })
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await expect(
      page.getByText(/Could not load this approval request/)
    ).toBeVisible({ timeout: 10000 });
  });

  test('expired state hides Approve/Deny buttons', async ({ page }) => {
    await page.route(`**/api/auth/ciba/request/${AUTH_REQ_ID}`, (route) =>
      route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({}) })
    );
    await page.goto(`/ciba-approve?authReqId=${AUTH_REQ_ID}`);
    await page.waitForTimeout(1000);
    await expect(page.getByRole('button', { name: 'Approve' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Deny' })).not.toBeVisible();
  });
});
