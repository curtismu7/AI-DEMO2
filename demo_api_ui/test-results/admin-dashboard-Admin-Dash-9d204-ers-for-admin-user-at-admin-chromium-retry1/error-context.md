# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-dashboard.spec.js >> Admin Dashboard >> renders for admin user at /admin
- Location: tests/e2e/admin-dashboard.spec.js:196:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.admin-dashboard-page')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('.admin-dashboard-page')

```

# Test source

```ts
  101 |           stepUpAcrValue: 'Multi_factor',
  102 |           stepUpTransactionTypes: ['withdrawal', 'transfer'],
  103 |           authorizeEnabled: false,
  104 |           authorizePolicyId: '',
  105 |         },
  106 |         history: [],
  107 |       }),
  108 |     })
  109 |   );
  110 | 
  111 |   // Dashboard.js loads these on mount (admin home)
  112 |   await page.route('**/api/admin/stats**', (route) =>
  113 |     route.fulfill({
  114 |       status: 200,
  115 |       contentType: 'application/json',
  116 |       body: JSON.stringify({
  117 |         stats: {
  118 |           totalUsers: 0,
  119 |           activeUsers: 0,
  120 |           totalAccounts: 0,
  121 |           totalTransactions: 0,
  122 |           totalBalance: 0,
  123 |           averageBalance: 0,
  124 |         },
  125 |       }),
  126 |     })
  127 |   );
  128 | 
  129 |   await page.route('**/api/admin/activity/recent**', (route) =>
  130 |     route.fulfill({
  131 |       status: 200,
  132 |       contentType: 'application/json',
  133 |       body: JSON.stringify({ logs: [] }),
  134 |     })
  135 |   );
  136 | 
  137 |   // Block any WebSocket or MCP connections (not needed for these tests)
  138 |   await page.route('**/ws**', (route) => route.abort());
  139 |   await page.route('**/mcp**', (route) => route.abort());
  140 | 
  141 |   // ThemeContext — stub with null manifest so default layout renders
  142 |   await page.route('**/api/config/vertical**', (route) =>
  143 |     route.fulfill({
  144 |       status: 200,
  145 |       contentType: 'application/json',
  146 |       body: JSON.stringify({ manifest: null }),
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
> 201 |     await expect(page.locator('.admin-dashboard-page')).toBeVisible({ timeout: 15000 });
      |                                                         ^ Error: expect(locator).toBeVisible() failed
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
  247 |     await expect(page.getByText(/accounts/i).first()).toBeVisible({ timeout: 5000 });
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
```