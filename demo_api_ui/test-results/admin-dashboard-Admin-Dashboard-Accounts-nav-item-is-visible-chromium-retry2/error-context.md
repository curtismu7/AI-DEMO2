# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-dashboard.spec.js >> Admin Dashboard >> Accounts nav item is visible
- Location: tests/e2e/admin-dashboard.spec.js:243:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/accounts/i).first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/accounts/i).first()

```

# Test source

```ts
  147 |     })
  148 |   );
  149 | 
  150 |   // Feature flags needed by Dashboard and BankingAgent
  151 |   await page.route('**/api/admin/feature-flags**', (route) =>
  152 |     route.fulfill({
  153 |       status: 200,
  154 |       contentType: 'application/json',
  155 |       body: JSON.stringify({ flags: [] }),
  156 |     })
  157 |   );
  158 | 
  159 |   // BankingAgent session check
  160 |   await page.route('**/api/auth/session**', (route) =>
  161 |     route.fulfill({
  162 |       status: 200,
  163 |       contentType: 'application/json',
  164 |       body: JSON.stringify(
  165 |         user.role === 'admin'
  166 |           ? { authenticated: true, user }
  167 |           : { authenticated: false }
  168 |       ),
  169 |     })
  170 |   );
  171 | 
  172 |   await page.route('**/api/admin/config**', (route) =>
  173 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ config: {} }) })
  174 |   );
  175 | 
  176 |   await page.route('**/api/tokens/session-preview**', (route) =>
  177 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tokenEvents: [] }) })
  178 |   );
  179 | 
  180 |   await page.route('**/api/token-chain**', (route) =>
  181 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tokenEvents: [] }) })
  182 |   );
  183 | 
  184 |   await page.route('**/api/admin/app-events**', (route) =>
  185 |     route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  186 |   );
  187 | 
  188 |   await page.route('**/api/pingone-test/config**', (route) =>
  189 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  190 |   );
  191 | }
  192 | 
  193 | // ─── Admin Dashboard Tests ────────────────────────────────────────────────────
  194 | 
  195 | test.describe('Admin Dashboard', () => {
  196 |   test('renders for admin user at /admin', async ({ page }) => {
  197 |     await mockAdminSession(page);
  198 |     await page.goto('/admin');
  199 | 
  200 |     // Admin dashboard renders .admin-dashboard-page (Dashboard.js root element).
  201 |     await expect(page.locator('.admin-dashboard-page')).toBeVisible({ timeout: 15000 });
  202 |   });
  203 | 
  204 |   test('admin route /admin renders the same dashboard', async ({ page }) => {
  205 |     await mockAdminSession(page);
  206 |     await page.goto('/admin');
  207 | 
  208 |     // Should not redirect away — URL should remain /admin
  209 |     await expect(page).toHaveURL(/\/(admin|$)/);
  210 |   });
  211 | 
  212 |   test('Security Settings navigation link is accessible for admin', async ({ page }) => {
  213 |     await mockAdminSession(page);
  214 |     await page.goto('/settings');
  215 | 
  216 |     // /settings route is admin-only; verify it loads without redirecting away
  217 |     await expect(page).toHaveURL(/\/settings/, { timeout: 15000 });
  218 |   });
  219 | 
  220 |   test('navigating directly to /settings renders the settings page', async ({ page }) => {
  221 |     await mockAdminSession(page);
  222 |     await page.goto('/settings');
  223 | 
  224 |     await expect(page).toHaveURL(/\/settings/, { timeout: 15000 });
  225 |     // Page should not redirect to / or /admin
  226 |     await expect(page).not.toHaveURL(/\/admin$|^\/$/, { timeout: 5000 });
  227 |   });
  228 | 
  229 |   test('Transactions admin route is accessible', async ({ page }) => {
  230 |     await mockAdminSession(page);
  231 |     await page.goto('/transactions');
  232 | 
  233 |     await expect(page).toHaveURL(/\/transactions/, { timeout: 15000 });
  234 |   });
  235 | 
  236 |   test('Users nav item is visible', async ({ page }) => {
  237 |     await mockAdminSession(page);
  238 |     await page.goto('/');
  239 | 
  240 |     await expect(page.getByText(/users/i).first()).toBeVisible({ timeout: 5000 });
  241 |   });
  242 | 
  243 |   test('Accounts nav item is visible', async ({ page }) => {
  244 |     await mockAdminSession(page);
  245 |     await page.goto('/');
  246 | 
> 247 |     await expect(page.getByText(/accounts/i).first()).toBeVisible({ timeout: 5000 });
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  248 |   });
  249 | 
  250 |   test('dashboard data requests omit Authorization header (Backend-for-Frontend (BFF) session cookie)', async ({ page }) => {
  251 |     await mockAdminSession(page);
  252 |     // Intercept any /api/ request and verify no Authorization header is sent.
  253 |     let checkedRequest = false;
  254 |     page.on('request', (req) => {
  255 |       if (req.url().includes('/api/') && req.method() === 'GET') {
  256 |         const auth = req.headers()['authorization'];
  257 |         expect(auth).toBeUndefined();
  258 |         checkedRequest = true;
  259 |       }
  260 |     });
  261 |     await page.goto('/');
  262 |     await page.waitForTimeout(3000);
  263 |     expect(checkedRequest).toBe(true);
  264 |   });
  265 | 
  266 |   test('admin dashboard loads without JS errors', async ({ page }) => {
  267 |     const errors = [];
  268 |     page.on('pageerror', (err) => errors.push(err.message));
  269 |     await mockAdminSession(page);
  270 |     await page.goto('/');
  271 |     // Allow page to settle
  272 |     await page.waitForTimeout(2000);
  273 |     // No uncaught JS errors from our changes
  274 |     const agUiErrors = errors.filter((e) => e.includes('agentRun') || e.includes('useAgentRun') || e.includes('applyJsonPatch'));
  275 |     expect(agUiErrors).toHaveLength(0);
  276 |   });
  277 | });
  278 | 
  279 | // ─── User Dashboard (non-admin) ───────────────────────────────────────────────
  280 | 
  281 | test.describe('User Dashboard (non-admin)', () => {
  282 |   test('non-admin user at / sees UserDashboard, not Admin Dashboard', async ({ page }) => {
  283 |     await mockAdminSession(page, CUSTOMER_USER);
  284 |     await page.goto('/');
  285 | 
  286 |     // Non-admin users should NOT see admin-only navigation items
  287 |     // The /settings route redirects non-admins away
  288 |     await page.goto('/settings');
  289 |     await expect(page.getByRole('heading', { name: /security settings/i })).not.toBeVisible({
  290 |       timeout: 3000,
  291 |     });
  292 |   });
  293 | 
  294 |   test('non-admin user is redirected from /admin to /', async ({ page }) => {
  295 |     await mockAdminSession(page, CUSTOMER_USER);
  296 |     await page.goto('/admin');
  297 | 
  298 |     // Should redirect to '/' (UserDashboard)
  299 |     await expect(page).not.toHaveURL(/\/admin$/);
  300 |   });
  301 | });
  302 | 
  303 | // ─── Logout ───────────────────────────────────────────────────────────────────
  304 | 
  305 | test.describe('Logout flow', () => {
  306 |   test('logout endpoint is called when Log Out is clicked', async ({ page }) => {
  307 |     await mockAdminSession(page);
  308 | 
  309 |     // performLogout() calls fetch('/api/auth/logout') — intercept that URL.
  310 |     let logoutCalled = false;
  311 |     await page.route('**/api/auth/logout**', (route) => {
  312 |       logoutCalled = true;
  313 |       return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  314 |     });
  315 | 
  316 |     await page.goto('/admin');
  317 |     await page.locator('.admin-dashboard-page').waitFor({ timeout: 15000 });
  318 | 
  319 |     // "Log Out" renders as a nav item in AdminSideNav (not a <button> role).
  320 |     // Find it by text content anywhere in the sidebar.
  321 |     const logoutItem = page.locator('[class*="nav"], [class*="side"], [class*="settings"]')
  322 |       .getByText('Log Out', { exact: true })
  323 |       .first();
  324 | 
  325 |     const fallback = page.getByText('Log Out', { exact: true }).first();
  326 |     const target = (await logoutItem.count()) > 0 ? logoutItem : fallback;
  327 | 
  328 |     if (await target.count() > 0) {
  329 |       await target.scrollIntoViewIfNeeded().catch(() => {});
  330 |       await target.click({ force: true });
  331 |       await page.waitForTimeout(1500);
  332 |       expect(logoutCalled).toBe(true);
  333 |     }
  334 |     // If the element is not found, skip — logout UI may vary per theme
  335 |   });
  336 | });
  337 | 
```