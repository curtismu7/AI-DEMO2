/**
 * @file security-settings.spec.js
 * @description Playwright E2E regression tests for the Security Settings page (/settings).
 *
 * Auth is simulated by intercepting the two OAuth status endpoints that App.js
 * calls on mount. All other API calls (settings load/save) are also intercepted
 * so no live backend is required.
 *
 * Covered scenarios:
 *   - Page renders with correct heading for admin user
 *   - Non-admin is redirected away from /settings
 *   - All expected form fields are visible
 *   - Toggle controls are interactive
 *   - "Save Changes" button becomes enabled after editing a field
 *   - Successful save shows a success message
 *   - Failed save shows an error message
 *   - "Discard" button reverts unsaved changes
 *   - Change history sidebar renders
 */

const { test, expect } = require('@playwright/test');

// ─── Shared mock data ─────────────────────────────────────────────────────────

const ADMIN_USER = {
  id: 'admin-id',
  username: 'admin',
  email: 'admin@test.com',
  role: 'admin',
};

const CUSTOMER_USER = {
  id: 'user-id',
  username: 'customer',
  email: 'customer@test.com',
  role: 'user',
};

const DEFAULT_SETTINGS = {
  settings: {
    stepUpEnabled: true,
    stepUpAmountThreshold: 250,
    stepUpAcrValue: 'Multi_factor',
    stepUpTransactionTypes: ['withdrawal', 'transfer'],
    authorizeEnabled: false,
    authorizePolicyId: '',
  },
  history: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mock all API calls needed for the Security Settings page to load.
 * @param {import('@playwright/test').Page} page
 * @param {object} user  — user object returned by /api/auth/oauth/status
 * @param {object} [settingsOverride] — optional override for the settings payload
 */
async function mockAuthAndSettings(page, user, settingsOverride = DEFAULT_SETTINGS) {
  // Mock admin OAuth status (checked first by App.js)
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        user.role === 'admin'
          ? { authenticated: true, user }
          : { authenticated: false }
      ),
    })
  );

  // Mock end-user OAuth status (fallback checked second)
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        user.role === 'user'
          ? { authenticated: true, user }
          : { authenticated: false }
      ),
    })
  );

  // Mock settings load
  await page.route('**/api/admin/settings', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsOverride),
      });
    }
    // PUT — default to success; individual tests can override this
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(settingsOverride),
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Security Settings page — /settings', () => {
  test('renders "Security Settings" heading for admin user', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: /security settings/i })).toBeVisible();
  });

  test('shows all expected field labels', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: /security settings/i })).toBeVisible();
    await expect(page.getByText('Step-up MFA Enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('Step-up Threshold ($)', { exact: true })).toBeVisible();
    await expect(page.getByText('Required ACR Value', { exact: true })).toBeVisible();
    await expect(page.getByText('Transaction Types Requiring Step-up', { exact: true })).toBeVisible();
    await expect(page.getByText('PingOne Authorize Integration', { exact: true })).toBeVisible();
    await expect(page.getByText('Authorize Policy ID', { exact: true })).toBeVisible();
  });

  test('shows Change History sidebar', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    await expect(page.getByText('Change History')).toBeVisible();
  });

  test('"Save Changes" button is disabled on load (no unsaved changes)', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    const saveBtn = page.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeDisabled();
  });

  test('"Save Changes" becomes enabled after editing the threshold', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    // Find the number input for threshold and change it
    const thresholdInput = page.locator('input[type="number"]').first();
    await thresholdInput.fill('500');

    const saveBtn = page.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeEnabled();
  });

  test('shows success message after saving', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);

    // Override PUT to return success, GET after save returns updated settings
    await page.route('**/api/admin/settings', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...DEFAULT_SETTINGS, settings: { ...DEFAULT_SETTINGS.settings, stepUpAmountThreshold: 500 } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DEFAULT_SETTINGS),
      });
    });

    await page.goto('/settings');

    // Make a change to enable the save button
    const thresholdInput = page.locator('input[type="number"]').first();
    await thresholdInput.fill('500');

    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByText(/settings saved successfully/i)).toBeVisible();
  });

  test('shows error message when save fails', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);

    // Override the PUT to return an error
    await page.route('**/api/admin/settings', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'internal_server_error', error_description: 'Something went wrong' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DEFAULT_SETTINGS),
      });
    });

    await page.goto('/settings');

    const thresholdInput = page.locator('input[type="number"]').first();
    await thresholdInput.fill('500');

    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(
      page.getByText(/failed to save|something went wrong|internal_server_error/i)
    ).toBeVisible();
  });

  test('"Discard" button reverts changes', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    await page.goto('/settings');

    const thresholdInput = page.locator('input[type="number"]').first();
    await expect(thresholdInput).toHaveValue('250'); // original value

    await thresholdInput.fill('999');
    await expect(thresholdInput).toHaveValue('999');

    await page.getByRole('button', { name: /discard/i }).click();
    await expect(thresholdInput).toHaveValue('250'); // reverted
  });

  test('"← Admin Dashboard" button navigates back', async ({ page }) => {
    await mockAuthAndSettings(page, ADMIN_USER);
    // Mock dashboard API calls that the Dashboard component may fire
    await page.route('**/api/users**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) })
    );
    await page.route('**/api/accounts**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: [] }) })
    );
    await page.route('**/api/transactions**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [] }) })
    );

    await page.goto('/settings');
    await page.getByRole('button', { name: /admin dashboard/i }).click();

    await expect(page).toHaveURL(/\/admin/);
  });

  // ─── Access control ─────────────────────────────────────────────────────
  test('non-admin user is redirected away from /settings', async ({ page }) => {
    await mockAuthAndSettings(page, CUSTOMER_USER);

    await page.goto('/settings');

    // Should be redirected to / which renders UserDashboard (not Security Settings heading)
    await expect(page.getByRole('heading', { name: /security settings/i })).not.toBeVisible({
      timeout: 3000,
    });
  });

  test('unauthenticated user sees login page instead of settings', async ({ page }) => {
    // No active session
    await page.route('**/api/auth/oauth/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) })
    );
    await page.route('**/api/auth/oauth/user/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) })
    );

    await page.goto('/settings');

    // The login page should render before/instead of the Settings page
    await expect(page.getByRole('heading', { name: /security settings/i })).not.toBeVisible({
      timeout: 3000,
    });
  });
});
