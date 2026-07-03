# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: landing-marketing.spec.js >> Marketing landing (unauthenticated) >> Admin Dashboard button triggers OAuth admin login path when unauthenticated
- Location: tests/e2e/landing-marketing.spec.js:51:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/
Call log:
  - navigating to "https://api.ping.demo:4000/", waiting until "load"

```

# Test source

```ts
  1  | /**
  2  |  * @file landing-marketing.spec.js
  3  |  * Unauthenticated marketing landing (LandingPage): hero, features, sign-in affordances.
  4  |  * API mocked — no server required.
  5  |  */
  6  | 
  7  | const { test, expect } = require('@playwright/test');
  8  | 
  9  | async function mockUnauthenticatedLanding(page) {
  10 |   await page.route('**/api/auth/oauth/status', (route) =>
  11 |     route.fulfill({
  12 |       status: 200,
  13 |       contentType: 'application/json',
  14 |       body: JSON.stringify({ authenticated: false, user: null }),
  15 |     }),
  16 |   );
  17 |   await page.route('**/api/auth/oauth/user/status', (route) =>
  18 |     route.fulfill({
  19 |       status: 200,
  20 |       contentType: 'application/json',
  21 |       body: JSON.stringify({ authenticated: false, user: null }),
  22 |     }),
  23 |   );
  24 |   await page.route('**/api/admin/config**', (route) =>
  25 |     route.fulfill({
  26 |       status: 200,
  27 |       contentType: 'application/json',
  28 |       body: JSON.stringify({ config: {} }),
  29 |     }),
  30 |   );
  31 |   await page.route('**/ws**', (route) => route.abort());
  32 | }
  33 | 
  34 | test.beforeEach(async ({ page }) => {
  35 |   await page.addInitScript(() => {
  36 |     try {
  37 |       localStorage.removeItem('userLoggedOut');
  38 |     } catch (_) {}
  39 |   });
  40 | });
  41 | 
  42 | test.describe('Marketing landing (unauthenticated)', () => {
  43 |   test('shows PingOne AI demo brand and hero headline', async ({ page }) => {
  44 |     await mockUnauthenticatedLanding(page);
  45 |     await page.goto('/');
  46 | 
  47 |     await expect(page.locator('.landing-page')).toBeVisible({ timeout: 15000 });
  48 |     await expect(page.getByText(/Secure Identity for AI-Powered Applications/i)).toBeVisible();
  49 |   });
  50 | 
  51 |   test('Admin Dashboard button triggers OAuth admin login path when unauthenticated', async ({ page }) => {
  52 |     await mockUnauthenticatedLanding(page);
  53 |     await page.route('**/api/auth/oauth/login**', (route) =>
  54 |       route.fulfill({ status: 302, headers: { Location: '/' }, body: '' }),
  55 |     );
  56 | 
> 57 |     await page.goto('/');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/
  58 | 
  59 |     const adminBtn = page.getByRole('button', { name: /Admin Dashboard/i }).first();
  60 |     await expect(adminBtn).toBeVisible({ timeout: 15000 });
  61 | 
  62 |     const [req] = await Promise.all([
  63 |       page.waitForRequest((r) => r.url().includes('/api/auth/oauth/login')),
  64 |       adminBtn.click(),
  65 |     ]);
  66 |     expect(req.method()).toBe('GET');
  67 |   });
  68 | 
  69 |   test('/configure route loads configuration page heading', async ({ page }) => {
  70 |     await mockUnauthenticatedLanding(page);
  71 |     await page.goto('/configure');
  72 | 
  73 |     await expect(page.getByRole('heading', { name: /Configuration/i }).first()).toBeVisible({ timeout: 15000 });
  74 |   });
  75 | });
  76 | 
```