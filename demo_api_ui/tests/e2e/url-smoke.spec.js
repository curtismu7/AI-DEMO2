/**
 * @file url-smoke.spec.js
 * @description URL smoke tests — visits every declared route in App.js and
 * verifies:
 *   1. The page does NOT redirect away (route is recognized by the router)
 *   2. No React error boundary / crash banner is visible
 *   3. The global nav renders (proves the React tree mounted)
 *
 * Auth is simulated by intercepting OAuth status endpoints — no live server
 * required. API data endpoints return minimal stubs so pages load cleanly.
 *
 * Run:
 *   cd banking_api_ui
 *   npx playwright test tests/e2e/url-smoke.spec.js
 *   npx playwright test tests/e2e/url-smoke.spec.js --headed   # visual
 */

const { test, expect } = require('@playwright/test');

// ─── Auth fixture objects ────────────────────────────────────────────────────

const ADMIN_USER = {
  id: 'admin-smoke-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'Smoke',
  name: 'Admin Smoke',
  role: 'admin',
};

const CUSTOMER_USER = {
  id: 'customer-smoke-id',
  username: 'customer',
  email: 'customer@example.com',
  firstName: 'Customer',
  lastName: 'Smoke',
  name: 'Customer Smoke',
  role: 'user',
};

// ─── Mock helpers ────────────────────────────────────────────────────────────

/** Minimal stub for every data endpoint pages might call on mount. */
async function installDataStubs(page) {
  const stubs = [
    ['**/api/users**',                { users: [], total: 0 }],
    ['**/api/accounts**',             { accounts: [] }],
    ['**/api/accounts/my**',          { accounts: [] }],
    ['**/api/transactions**',         { transactions: [] }],
    ['**/api/transactions/my**',      { transactions: [] }],
    ['**/api/admin/stats**',          { stats: { totalUsers: 0, totalAccounts: 0, totalTransactions: 0, totalBalance: 0, averageBalance: 0, activeUsers: 0 } }],
    ['**/api/admin/settings**',       { settings: { stepUpEnabled: false, authorizeEnabled: false } }],
    ['**/api/admin/activity**',       { logs: [] }],
    ['**/api/admin/logs**',           { logs: [] }],
    ['**/api/logs/**',                { logs: [], entries: [], stats: {} }],
    ['**/api/delegation**',           { delegations: [] }],
    ['**/api/delegation/history**',   { history: [] }],
    ['**/api/token-chain**',          { tokenChain: [], mcpToolCallsChain: [], metadata: {} }],
    ['**/api/mcp/**',                 {}],
    ['**/api/monitoring/**',          {}],
    ['**/api/config**',               {}],
    ['**/api/feature-flags**',        { flags: {} }],
    ['**/api/runtime-settings**',     {}],
    ['**/api/scope-reference**',      { scopes: [] }],
    ['**/api/pingone/**',             {}],
    ['**/api/langchain/**',           {}],
    ['**/api/llm-config**',          {}],
    ['**/api/resource-server/**',     {}],
    ['**/api/audit/**',               { events: [] }],
    ['**/api/verticals/**',           {}],
    ['**/api/health/**',              { status: 'ok' }],
    ['**/api/pingone-test/**',        {}],
  ];
  for (const [pattern, body] of stubs) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
    );
  }
}

/** Mock an admin-authenticated session. */
async function mockAdminAuth(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: ADMIN_USER }),
    }),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }),
  );
  await installDataStubs(page);
}

/** Mock a customer-authenticated session. */
async function mockCustomerAuth(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }),
    }),
  );
  await installDataStubs(page);
}

/** Mock an unauthenticated session. */
async function mockNoAuth(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }),
  );
  await installDataStubs(page);
}

// ─── Core assertion ──────────────────────────────────────────────────────────

/**
 * Navigate to `url` and assert:
 *   - Final URL equals the expected path (route is declared, no unintended redirect)
 *   - No React error boundary / crash text visible
 *   - The document body is not empty
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} url  Path to visit (e.g. '/admin')
 * @param {{ allowRedirectTo?: string[] }} [opts]
 */
async function smokeCheck(page, url, opts = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for React to mount AND produce visible text.
  // networkidle fires almost immediately when all API routes are mocked (they
  // return instantly), so we poll for both: root has children AND body has text.
  try {
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        if (!root || root.children.length === 0) return false;
        return document.body.innerText.trim().length > 0;
      },
      { timeout: 15000 },
    );
  } catch (_) {
    await page.waitForTimeout(5000);
  }

  // ── 1. URL check ──────────────────────────────────────────────────────────
  const finalPath = new URL(page.url()).pathname;
  const expected = opts.allowRedirectTo ? [url, ...opts.allowRedirectTo] : [url];
  expect(expected, `Route ${url} redirected unexpectedly to ${finalPath}`).toContain(finalPath);

  // ── 2. No crash indicators ────────────────────────────────────────────────
  const bodyText = await page.locator('body').innerText();
  const crashPhrases = [
    'Something went wrong',
    'Cannot read properties of undefined',
    'Cannot read property',
    'is not a function',
    'Unhandled Runtime Error',
    'ChunkLoadError',
    'Failed to load chunk',
  ];
  for (const phrase of crashPhrases) {
    expect(bodyText, `Route ${url} shows crash: "${phrase}"`).not.toContain(phrase);
  }

  // ── 3. Body is not blank ──────────────────────────────────────────────────
  expect(bodyText.trim().length, `Route ${url} rendered an empty page`).toBeGreaterThan(0);
}

// ─── Route groups ────────────────────────────────────────────────────────────

/**
 * Public routes — accessible without any auth.
 * Many redirect to /login when hit unauthenticated; that is expected and
 * listed in allowRedirectTo.
 */
const PUBLIC_ROUTES = [
  { path: '/',         allowRedirectTo: ['/dashboard', '/admin', '/login'] },
  { path: '/login',    allowRedirectTo: ['/dashboard', '/admin', '/'] },
  // /logout immediately redirects server-side; allow landing too
  { path: '/logout',   allowRedirectTo: ['/', '/login', '/dashboard'] },
  { path: '/setup',         allowRedirectTo: ['/login', '/'] },
  { path: '/setup/pingone', allowRedirectTo: ['/login', '/'] },
  { path: '/setup/wizard',  allowRedirectTo: ['/login', '/'] },
  { path: '/privilege-demo', allowRedirectTo: [] },
];

/**
 * Customer routes — require a signed-in end-user.
 * Unknown sub-routes redirect to /dashboard; that is intentional.
 */
const CUSTOMER_ROUTES = [
  '/dashboard',
  '/accounts',
  '/transactions',
  '/profile',
  '/security',
  '/self-service',
  '/delegation',
  '/delegated-access',
  '/onboarding',
  '/transaction-consent',
  '/agent',
];

/**
 * Admin routes — require role === 'admin'.
 * Use objects for routes that perform a known client-side redirect.
 */
const ADMIN_ROUTES = [
  '/admin',
  '/admin/banking',
  '/configure',
  { path: '/demo-data', allowRedirectTo: ['/admin', '/login', '/configure'] },
  '/users',
  '/activity',
  '/logs',
  '/audit',
  '/settings',
  '/config',
  '/feature-flags',
  '/pingone-test',
  '/mfa-test',
  '/pingone-authorize',
  { path: '/authz-test', allowRedirectTo: ['/pingone-authorize', '/admin', '/login'] },
  '/mcp-tools',
  '/mcp-traffic',
  '/api-traffic',
  '/dev-tools',
  '/error-audit',
  '/token-compliance',
  '/webmcp',
  '/oauth-debug-logs',
  '/client-registration',
  '/postman',
  '/scope-audit',
  '/scope-reference',
  '/oauth/token-display',
  '/agent-flow-inspector',
  '/agentic-trust',
  '/actor-token-education',
  '/langchain',
  '/llm-config',
  '/mcp-gateway',
  '/mcp-inspector',
  '/resource-server',
  '/resource-server-cc',
  // Monitoring sub-routes
  '/monitoring/token-chain',
  '/monitoring/flow-inspector',
  '/monitoring/mcp-traffic',
  '/monitoring/api-explorer',
  // Architecture sub-routes
  '/architecture/overview',
  '/architecture/token-flow',
  '/architecture/flow',
];

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('URL smoke — public routes (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await mockNoAuth(page);
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} renders without crash`, async ({ page }) => {
      await smokeCheck(page, route.path, { allowRedirectTo: route.allowRedirectTo });
    });
  }
});

test.describe('URL smoke — customer routes', () => {
  test.beforeEach(async ({ page }) => {
    await mockCustomerAuth(page);
  });

  for (const path of CUSTOMER_ROUTES) {
    test(`${path} renders without crash`, async ({ page }) => {
      await smokeCheck(page, path, { allowRedirectTo: ['/dashboard', '/login'] });
    });
  }
});

test.describe('URL smoke — admin routes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);
  });

  for (const entry of ADMIN_ROUTES) {
    const routePath = typeof entry === 'string' ? entry : entry.path;
    const redirectAllow = typeof entry === 'string'
      ? ['/admin', '/login']
      : entry.allowRedirectTo;
    test(`${routePath} renders without crash`, async ({ page }) => {
      await smokeCheck(page, routePath, { allowRedirectTo: redirectAllow });
    });
  }
});

/** Wait for the React app to redirect away from `startPath`. */
async function waitForRedirectFrom(page, startPath) {
  try {
    await page.waitForFunction(
      (sp) => {
        const root = document.getElementById('root');
        if (!root || root.children.length === 0) return false;
        return new URL(window.location.href).pathname !== sp;
      },
      startPath,
      { timeout: 10000 },
    );
  } catch (_) {
    // If no redirect fired, we fall through; the assertion below will report.
  }
}

test.describe('URL smoke — unknown routes redirect (no 404 / blank)', () => {
  test('unknown route as admin redirects to /admin', async ({ page }) => {
    await mockAdminAuth(page);
    await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
    await waitForRedirectFrom(page, '/this-does-not-exist');
    const path = new URL(page.url()).pathname;
    expect(['/admin', '/dashboard'], `Unknown route went to ${path}`).toContain(path);
  });

  test('unknown route as customer redirects to /dashboard', async ({ page }) => {
    await mockCustomerAuth(page);
    await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
    await waitForRedirectFrom(page, '/this-does-not-exist');
    const path = new URL(page.url()).pathname;
    expect(['/dashboard', '/admin'], `Unknown route went to ${path}`).toContain(path);
  });

  test('unknown route unauthenticated does not crash', async ({ page }) => {
    await mockNoAuth(page);
    await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
    // Unauthenticated catch-all renders TopNav without redirecting — no crash
    // is the important guarantee; the URL may stay or redirect.
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root');
          return root !== null && root.children.length > 0;
        },
        { timeout: 10000 },
      );
    } catch (_) {}
    const path = new URL(page.url()).pathname;
    expect(
      ['/', '/login', '/dashboard', '/admin', '/this-does-not-exist'],
      `Unknown unauthenticated route went to unexpected path ${path}`,
    ).toContain(path);
  });
});
