# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: url-smoke.spec.js >> URL smoke — admin routes >> /settings renders without crash
- Location: tests/e2e/url-smoke.spec.js:317:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/settings
Call log:
  - navigating to "https://api.ping.demo:4000/settings", waiting until "domcontentloaded"

```

# Test source

```ts
  52  |     ['**/api/admin/stats**',          { stats: { totalUsers: 0, totalAccounts: 0, totalTransactions: 0, totalBalance: 0, averageBalance: 0, activeUsers: 0 } }],
  53  |     ['**/api/admin/settings**',       { settings: { stepUpEnabled: false, authorizeEnabled: false } }],
  54  |     ['**/api/admin/activity**',       { logs: [] }],
  55  |     ['**/api/admin/logs**',           { logs: [] }],
  56  |     ['**/api/logs/**',                { logs: [], entries: [], stats: {} }],
  57  |     ['**/api/delegation**',           { delegations: [] }],
  58  |     ['**/api/delegation/history**',   { history: [] }],
  59  |     ['**/api/token-chain**',          { tokenChain: [], mcpToolCallsChain: [], metadata: {} }],
  60  |     ['**/api/mcp/**',                 {}],
  61  |     ['**/api/monitoring/**',          {}],
  62  |     ['**/api/config**',               {}],
  63  |     ['**/api/feature-flags**',        { flags: {} }],
  64  |     ['**/api/runtime-settings**',     {}],
  65  |     ['**/api/scope-reference**',      { scopes: [] }],
  66  |     ['**/api/pingone/**',             {}],
  67  |     ['**/api/langchain/**',           {}],
  68  |     ['**/api/llm-config**',          {}],
  69  |     ['**/api/resource-server/**',     {}],
  70  |     ['**/api/audit/**',               { events: [] }],
  71  |     ['**/api/verticals/**',           {}],
  72  |     ['**/api/health/**',              { status: 'ok' }],
  73  |     ['**/api/pingone-test/**',        {}],
  74  |   ];
  75  |   for (const [pattern, body] of stubs) {
  76  |     await page.route(pattern, (route) =>
  77  |       route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  78  |     );
  79  |   }
  80  | }
  81  | 
  82  | /** Mock an admin-authenticated session. */
  83  | async function mockAdminAuth(page) {
  84  |   await page.route('**/api/auth/oauth/status', (route) =>
  85  |     route.fulfill({
  86  |       status: 200,
  87  |       contentType: 'application/json',
  88  |       body: JSON.stringify({ authenticated: true, user: ADMIN_USER }),
  89  |     }),
  90  |   );
  91  |   await page.route('**/api/auth/oauth/user/status', (route) =>
  92  |     route.fulfill({
  93  |       status: 200,
  94  |       contentType: 'application/json',
  95  |       body: JSON.stringify({ authenticated: false }),
  96  |     }),
  97  |   );
  98  |   await installDataStubs(page);
  99  | }
  100 | 
  101 | /** Mock a customer-authenticated session. */
  102 | async function mockCustomerAuth(page) {
  103 |   await page.route('**/api/auth/oauth/status', (route) =>
  104 |     route.fulfill({
  105 |       status: 200,
  106 |       contentType: 'application/json',
  107 |       body: JSON.stringify({ authenticated: false }),
  108 |     }),
  109 |   );
  110 |   await page.route('**/api/auth/oauth/user/status', (route) =>
  111 |     route.fulfill({
  112 |       status: 200,
  113 |       contentType: 'application/json',
  114 |       body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }),
  115 |     }),
  116 |   );
  117 |   await installDataStubs(page);
  118 | }
  119 | 
  120 | /** Mock an unauthenticated session. */
  121 | async function mockNoAuth(page) {
  122 |   await page.route('**/api/auth/oauth/status', (route) =>
  123 |     route.fulfill({
  124 |       status: 200,
  125 |       contentType: 'application/json',
  126 |       body: JSON.stringify({ authenticated: false }),
  127 |     }),
  128 |   );
  129 |   await page.route('**/api/auth/oauth/user/status', (route) =>
  130 |     route.fulfill({
  131 |       status: 200,
  132 |       contentType: 'application/json',
  133 |       body: JSON.stringify({ authenticated: false }),
  134 |     }),
  135 |   );
  136 |   await installDataStubs(page);
  137 | }
  138 | 
  139 | // ─── Core assertion ──────────────────────────────────────────────────────────
  140 | 
  141 | /**
  142 |  * Navigate to `url` and assert:
  143 |  *   - Final URL equals the expected path (route is declared, no unintended redirect)
  144 |  *   - No React error boundary / crash text visible
  145 |  *   - The document body is not empty
  146 |  *
  147 |  * @param {import('@playwright/test').Page} page
  148 |  * @param {string} url  Path to visit (e.g. '/admin')
  149 |  * @param {{ allowRedirectTo?: string[] }} [opts]
  150 |  */
  151 | async function smokeCheck(page, url, opts = {}) {
> 152 |   await page.goto(url, { waitUntil: 'domcontentloaded' });
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/settings
  153 | 
  154 |   // Wait for React to mount AND produce visible text.
  155 |   // networkidle fires almost immediately when all API routes are mocked (they
  156 |   // return instantly), so we poll for both: root has children AND body has text.
  157 |   try {
  158 |     await page.waitForFunction(
  159 |       () => {
  160 |         const root = document.getElementById('root');
  161 |         if (!root || root.children.length === 0) return false;
  162 |         return document.body.innerText.trim().length > 0;
  163 |       },
  164 |       { timeout: 15000 },
  165 |     );
  166 |   } catch (_) {
  167 |     await page.waitForTimeout(5000);
  168 |   }
  169 | 
  170 |   // ── 1. URL check ──────────────────────────────────────────────────────────
  171 |   const finalPath = new URL(page.url()).pathname;
  172 |   const expected = opts.allowRedirectTo ? [url, ...opts.allowRedirectTo] : [url];
  173 |   expect(expected, `Route ${url} redirected unexpectedly to ${finalPath}`).toContain(finalPath);
  174 | 
  175 |   // ── 2. No crash indicators ────────────────────────────────────────────────
  176 |   const bodyText = await page.locator('body').innerText();
  177 |   const crashPhrases = [
  178 |     'Something went wrong',
  179 |     'Cannot read properties of undefined',
  180 |     'Cannot read property',
  181 |     'is not a function',
  182 |     'Unhandled Runtime Error',
  183 |     'ChunkLoadError',
  184 |     'Failed to load chunk',
  185 |   ];
  186 |   for (const phrase of crashPhrases) {
  187 |     expect(bodyText, `Route ${url} shows crash: "${phrase}"`).not.toContain(phrase);
  188 |   }
  189 | 
  190 |   // ── 3. Body is not blank ──────────────────────────────────────────────────
  191 |   expect(bodyText.trim().length, `Route ${url} rendered an empty page`).toBeGreaterThan(0);
  192 | }
  193 | 
  194 | // ─── Route groups ────────────────────────────────────────────────────────────
  195 | 
  196 | /**
  197 |  * Public routes — accessible without any auth.
  198 |  * Many redirect to /login when hit unauthenticated; that is expected and
  199 |  * listed in allowRedirectTo.
  200 |  */
  201 | const PUBLIC_ROUTES = [
  202 |   { path: '/',         allowRedirectTo: ['/dashboard', '/admin', '/login'] },
  203 |   { path: '/login',    allowRedirectTo: ['/dashboard', '/admin', '/'] },
  204 |   // /logout immediately redirects server-side; allow landing too
  205 |   { path: '/logout',   allowRedirectTo: ['/', '/login', '/dashboard'] },
  206 |   { path: '/setup',         allowRedirectTo: ['/login', '/'] },
  207 |   { path: '/setup/pingone', allowRedirectTo: ['/login', '/'] },
  208 |   { path: '/setup/wizard',  allowRedirectTo: ['/login', '/'] },
  209 | ];
  210 | 
  211 | /**
  212 |  * Customer routes — require a signed-in end-user.
  213 |  * Unknown sub-routes redirect to /dashboard; that is intentional.
  214 |  */
  215 | const CUSTOMER_ROUTES = [
  216 |   '/dashboard',
  217 |   '/accounts',
  218 |   '/transactions',
  219 |   '/profile',
  220 |   '/security',
  221 |   '/self-service',
  222 |   '/delegation',
  223 |   '/delegated-access',
  224 |   '/onboarding',
  225 |   '/transaction-consent',
  226 |   '/agent',
  227 | ];
  228 | 
  229 | /**
  230 |  * Admin routes — require role === 'admin'.
  231 |  * Use objects for routes that perform a known client-side redirect.
  232 |  */
  233 | const ADMIN_ROUTES = [
  234 |   '/admin',
  235 |   '/admin/banking',
  236 |   '/configure',
  237 |   { path: '/demo-data', allowRedirectTo: ['/admin', '/login', '/configure'] },
  238 |   '/users',
  239 |   '/activity',
  240 |   '/logs',
  241 |   '/audit',
  242 |   '/settings',
  243 |   '/config',
  244 |   '/feature-flags',
  245 |   '/pingone-test',
  246 |   '/mfa-test',
  247 |   '/authz-test',
  248 |   '/mcp-tools',
  249 |   '/mcp-traffic',
  250 |   '/api-traffic',
  251 |   '/dev-tools',
  252 |   '/error-audit',
```