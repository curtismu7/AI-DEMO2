# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: security-settings.spec.js >> Security Settings page — /settings >> "Save Changes" button is disabled on load (no unsaved changes)
- Location: tests/e2e/security-settings.spec.js:134:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/settings
Call log:
  - navigating to "https://api.ping.demo:4000/settings", waiting until "load"

```

# Test source

```ts
  36  |   role: 'user',
  37  | };
  38  | 
  39  | const DEFAULT_SETTINGS = {
  40  |   settings: {
  41  |     stepUpEnabled: true,
  42  |     stepUpAmountThreshold: 250,
  43  |     stepUpAcrValue: 'Multi_factor',
  44  |     stepUpTransactionTypes: ['withdrawal', 'transfer'],
  45  |     authorizeEnabled: false,
  46  |     authorizePolicyId: '',
  47  |   },
  48  |   history: [],
  49  | };
  50  | 
  51  | // ─── Helpers ──────────────────────────────────────────────────────────────────
  52  | 
  53  | /**
  54  |  * Mock all API calls needed for the Security Settings page to load.
  55  |  * @param {import('@playwright/test').Page} page
  56  |  * @param {object} user  — user object returned by /api/auth/oauth/status
  57  |  * @param {object} [settingsOverride] — optional override for the settings payload
  58  |  */
  59  | async function mockAuthAndSettings(page, user, settingsOverride = DEFAULT_SETTINGS) {
  60  |   // Mock admin OAuth status (checked first by App.js)
  61  |   await page.route('**/api/auth/oauth/status', (route) =>
  62  |     route.fulfill({
  63  |       status: 200,
  64  |       contentType: 'application/json',
  65  |       body: JSON.stringify(
  66  |         user.role === 'admin'
  67  |           ? { authenticated: true, user }
  68  |           : { authenticated: false }
  69  |       ),
  70  |     })
  71  |   );
  72  | 
  73  |   // Mock end-user OAuth status (fallback checked second)
  74  |   await page.route('**/api/auth/oauth/user/status', (route) =>
  75  |     route.fulfill({
  76  |       status: 200,
  77  |       contentType: 'application/json',
  78  |       body: JSON.stringify(
  79  |         user.role === 'user'
  80  |           ? { authenticated: true, user }
  81  |           : { authenticated: false }
  82  |       ),
  83  |     })
  84  |   );
  85  | 
  86  |   // Mock settings load
  87  |   await page.route('**/api/admin/settings', (route) => {
  88  |     if (route.request().method() === 'GET') {
  89  |       return route.fulfill({
  90  |         status: 200,
  91  |         contentType: 'application/json',
  92  |         body: JSON.stringify(settingsOverride),
  93  |       });
  94  |     }
  95  |     // PUT — default to success; individual tests can override this
  96  |     return route.fulfill({
  97  |       status: 200,
  98  |       contentType: 'application/json',
  99  |       body: JSON.stringify(settingsOverride),
  100 |     });
  101 |   });
  102 | }
  103 | 
  104 | // ─── Tests ────────────────────────────────────────────────────────────────────
  105 | 
  106 | test.describe('Security Settings page — /settings', () => {
  107 |   test('renders "Security Settings" heading for admin user', async ({ page }) => {
  108 |     await mockAuthAndSettings(page, ADMIN_USER);
  109 |     await page.goto('/settings');
  110 | 
  111 |     await expect(page.getByRole('heading', { name: /security settings/i })).toBeVisible();
  112 |   });
  113 | 
  114 |   test('shows all expected field labels', async ({ page }) => {
  115 |     await mockAuthAndSettings(page, ADMIN_USER);
  116 |     await page.goto('/settings');
  117 | 
  118 |     await expect(page.getByRole('heading', { name: /security settings/i })).toBeVisible();
  119 |     await expect(page.getByText('Step-up MFA Enabled', { exact: true })).toBeVisible();
  120 |     await expect(page.getByText('Step-up Threshold ($)', { exact: true })).toBeVisible();
  121 |     await expect(page.getByText('Required ACR Value', { exact: true })).toBeVisible();
  122 |     await expect(page.getByText('Transaction Types Requiring Step-up', { exact: true })).toBeVisible();
  123 |     await expect(page.getByText('PingOne Authorize Integration', { exact: true })).toBeVisible();
  124 |     await expect(page.getByText('Authorize Policy ID', { exact: true })).toBeVisible();
  125 |   });
  126 | 
  127 |   test('shows Change History sidebar', async ({ page }) => {
  128 |     await mockAuthAndSettings(page, ADMIN_USER);
  129 |     await page.goto('/settings');
  130 | 
  131 |     await expect(page.getByText('Change History')).toBeVisible();
  132 |   });
  133 | 
  134 |   test('"Save Changes" button is disabled on load (no unsaved changes)', async ({ page }) => {
  135 |     await mockAuthAndSettings(page, ADMIN_USER);
> 136 |     await page.goto('/settings');
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/settings
  137 | 
  138 |     const saveBtn = page.getByRole('button', { name: /save changes/i });
  139 |     await expect(saveBtn).toBeDisabled();
  140 |   });
  141 | 
  142 |   test('"Save Changes" becomes enabled after editing the threshold', async ({ page }) => {
  143 |     await mockAuthAndSettings(page, ADMIN_USER);
  144 |     await page.goto('/settings');
  145 | 
  146 |     // Find the number input for threshold and change it
  147 |     const thresholdInput = page.locator('input[type="number"]').first();
  148 |     await thresholdInput.fill('500');
  149 | 
  150 |     const saveBtn = page.getByRole('button', { name: /save changes/i });
  151 |     await expect(saveBtn).toBeEnabled();
  152 |   });
  153 | 
  154 |   test('shows success message after saving', async ({ page }) => {
  155 |     await mockAuthAndSettings(page, ADMIN_USER);
  156 | 
  157 |     // Override PUT to return success, GET after save returns updated settings
  158 |     await page.route('**/api/admin/settings', (route) => {
  159 |       if (route.request().method() === 'PUT') {
  160 |         return route.fulfill({
  161 |           status: 200,
  162 |           contentType: 'application/json',
  163 |           body: JSON.stringify({ ...DEFAULT_SETTINGS, settings: { ...DEFAULT_SETTINGS.settings, stepUpAmountThreshold: 500 } }),
  164 |         });
  165 |       }
  166 |       return route.fulfill({
  167 |         status: 200,
  168 |         contentType: 'application/json',
  169 |         body: JSON.stringify(DEFAULT_SETTINGS),
  170 |       });
  171 |     });
  172 | 
  173 |     await page.goto('/settings');
  174 | 
  175 |     // Make a change to enable the save button
  176 |     const thresholdInput = page.locator('input[type="number"]').first();
  177 |     await thresholdInput.fill('500');
  178 | 
  179 |     await page.getByRole('button', { name: /save changes/i }).click();
  180 | 
  181 |     await expect(page.getByText(/settings saved successfully/i)).toBeVisible();
  182 |   });
  183 | 
  184 |   test('shows error message when save fails', async ({ page }) => {
  185 |     await mockAuthAndSettings(page, ADMIN_USER);
  186 | 
  187 |     // Override the PUT to return an error
  188 |     await page.route('**/api/admin/settings', (route) => {
  189 |       if (route.request().method() === 'PUT') {
  190 |         return route.fulfill({
  191 |           status: 500,
  192 |           contentType: 'application/json',
  193 |           body: JSON.stringify({ error: 'internal_server_error', error_description: 'Something went wrong' }),
  194 |         });
  195 |       }
  196 |       return route.fulfill({
  197 |         status: 200,
  198 |         contentType: 'application/json',
  199 |         body: JSON.stringify(DEFAULT_SETTINGS),
  200 |       });
  201 |     });
  202 | 
  203 |     await page.goto('/settings');
  204 | 
  205 |     const thresholdInput = page.locator('input[type="number"]').first();
  206 |     await thresholdInput.fill('500');
  207 | 
  208 |     await page.getByRole('button', { name: /save changes/i }).click();
  209 | 
  210 |     await expect(
  211 |       page.getByText(/failed to save|something went wrong|internal_server_error/i)
  212 |     ).toBeVisible();
  213 |   });
  214 | 
  215 |   test('"Discard" button reverts changes', async ({ page }) => {
  216 |     await mockAuthAndSettings(page, ADMIN_USER);
  217 |     await page.goto('/settings');
  218 | 
  219 |     const thresholdInput = page.locator('input[type="number"]').first();
  220 |     await expect(thresholdInput).toHaveValue('250'); // original value
  221 | 
  222 |     await thresholdInput.fill('999');
  223 |     await expect(thresholdInput).toHaveValue('999');
  224 | 
  225 |     await page.getByRole('button', { name: /discard/i }).click();
  226 |     await expect(thresholdInput).toHaveValue('250'); // reverted
  227 |   });
  228 | 
  229 |   test('"← Admin Dashboard" button navigates back', async ({ page }) => {
  230 |     await mockAuthAndSettings(page, ADMIN_USER);
  231 |     // Mock dashboard API calls that the Dashboard component may fire
  232 |     await page.route('**/api/users**', (route) =>
  233 |       route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) })
  234 |     );
  235 |     await page.route('**/api/accounts**', (route) =>
  236 |       route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: [] }) })
```