/**
 * @file session-lab.spec.js
 * /session-lab with the API mocked: the real-session half renders what the BFF endpoints return,
 * and the simulated lab follows the documented model. Proves rendering and behaviour, not a live login.
 */
const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');

const IN_30_MIN = () => Date.now() + 30 * 60 * 1000;
const payload = { sub: 'u1', auth_time: 1790000000, amr: ['pwd', 'mfa'], sid: 'sid-abc', iat: 1790000100, exp: 1790003700 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('userLoggedOut'); } catch (_) {} });
  await mockCustomerDashboard(page);
  await page.route('**/api/auth/oauth/user/status', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, loginProvider: 'pingone', sessionType: 'user', expiresAt: IN_30_MIN(), hasRefreshToken: true, user: { id: 'u1', username: 'testuser', role: 'customer' } }),
  }));
  await page.route('**/api/auth/oauth/user/token-claims', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, decoded: { header: {}, payload: { sub: 'u1' } }, idToken: { header: {}, payload } }),
  }));
  await page.goto('/session-lab');
});

test('shows the real-session facts and says the PingOne cookie is unreadable', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Session Lab' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('cell', { name: 'pwd, mfa' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'sid-abc' })).toBeVisible();
  await expect(page.locator('.session-lab__note').getByText('cannot read it', { exact: false })).toBeVisible();
});

test('diagram has Simulate and Reset', async ({ page }) => {
  const d = page.getByTestId('session-lab-diagram');
  await expect(d).toBeVisible({ timeout: 15000 });
  await expect(d.getByRole('button', { name: /simulate/i }).first()).toBeVisible();
  await expect(d.getByRole('button', { name: /reset/i }).first()).toBeVisible();
});

test('simulated lab: per-method times, sticky SSO, expiry', async ({ page }) => {
  await expect(page.getByText('Simulated.', { exact: false })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Sign in with password' }).click();
  await expect(page.getByRole('rowheader', { name: 'last sign-on · pwd' })).toBeVisible();
  await page.getByRole('button', { name: '+9 hours' }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('session-lab-result')).toContainText('FAIL: last sign-on older than 480 min');
  await page.getByRole('button', { name: 'Report mfa, no challenge' }).click();
  await page.getByLabel('Method').selectOption('mfa');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('session-lab-result')).toContainText('PASS');
  await page.getByRole('button', { name: 'Delete session' }).click();
  await expect(page.getByRole('cell', { name: 'no session' })).toBeVisible();
});

test('no horizontal scroll at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole('heading', { name: 'Session Lab' })).toBeVisible({ timeout: 15000 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});
