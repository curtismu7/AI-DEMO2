/**
 * @file landing-marketing.spec.js
 * Unauthenticated marketing landing (LandingPage): hero, features, sign-in affordances.
 * API mocked — no server required.
 */

const { test, expect } = require('@playwright/test');

async function mockUnauthenticatedLanding(page) {
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
      body: JSON.stringify({ authenticated: false, user: null }),
    }),
  );
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ config: {} }),
    }),
  );
  await page.route('**/ws**', (route) => route.abort());
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('userLoggedOut');
    } catch (_) {}
  });
});

test.describe('Marketing landing (unauthenticated)', () => {
  test('shows PingOne AI demo brand and hero headline', async ({ page }) => {
    await mockUnauthenticatedLanding(page);
    await page.goto('/');

    await expect(page.locator('.landing-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Secure Identity for AI-Powered Applications/i)).toBeVisible();
  });

  test('Admin Dashboard button triggers OAuth admin login path when unauthenticated', async ({ page }) => {
    await mockUnauthenticatedLanding(page);
    await page.route('**/api/auth/oauth/login**', (route) =>
      route.fulfill({ status: 302, headers: { Location: '/' }, body: '' }),
    );

    await page.goto('/');

    const adminBtn = page.getByRole('button', { name: /Admin Dashboard/i }).first();
    await expect(adminBtn).toBeVisible({ timeout: 15000 });

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/auth/oauth/login')),
      adminBtn.click(),
    ]);
    expect(req.method()).toBe('GET');
  });

  test('/configure route loads configuration page heading', async ({ page }) => {
    await mockUnauthenticatedLanding(page);
    await page.goto('/configure');

    await expect(page.getByRole('heading', { name: /Configuration/i }).first()).toBeVisible({ timeout: 15000 });
  });
});
