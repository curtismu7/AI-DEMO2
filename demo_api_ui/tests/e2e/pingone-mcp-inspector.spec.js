/**
 * @file pingone-mcp-inspector.spec.js
 * @description Playwright E2E tests for the unified MCP Inspector page
 * (/pingone-mcp-inspector).
 *
 * All API calls are intercepted with stubs — no live server required.
 */

const { test, expect } = require('@playwright/test');

// ─── Fixture data ─────────────────────────────────────────────────────────────

const BANKING_TOOL = {
  name: 'get_account_balance',
  description: 'Get current balance for a specific account.',
  inputSchema: {
    type: 'object',
    properties: { account_id: { type: 'string', description: 'Account ID' } },
    required: ['account_id'],
  },
  requiredScopes: ['accounts:read'],
};

const PINGONE_TOOL = {
  name: 'GetUserById',
  description: 'Fetch one PingOne user by ID.',
  inputSchema: {
    type: 'object',
    properties: { user_id: { type: 'string' } },
    required: ['user_id'],
  },
};

const CUSTOM_TOOL = {
  name: 'brave_web_search',
  description: 'Search the web via Brave.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  requiredScopes: [],
};

const CAPTURED_CALL = {
  id: 'c1',
  method: 'GET',
  url: '/api/accounts/acc_1',
  success: true,
  response: { status: 200, body: { balance: 100 } },
  request: { headers: {} },
  durationMs: 38,
};

// ─── Route helpers ────────────────────────────────────────────────────────────

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Stubs the minimum infrastructure routes all inspector variants need. */
async function mockBase(page) {
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(json({ authenticated: false })));
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(json({ authenticated: false })));
  await page.route('**/api/auth/session', (r) => r.fulfill(json({ authenticated: false })));
  await page.route('**/api/admin/feature-flags**', (r) => r.fulfill(json({ flags: [] })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(json({ manifest: null })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(json({ tokenEvents: [] })));
  await page.route('**/api/token-chain**', (r) => r.fulfill(json({ tokenEvents: [] })));
  await page.route('**/api/admin/app-events**', (r) => r.fulfill(json({ ok: true }, 201)));
  await page.route('**/ws**', (r) => r.abort());
  // API calls polling (useApiCallsSource fetches /api/api-calls, not /api/mcp/calls)
  await page.route('**/api/api-calls**', (r) => r.fulfill(json({ calls: [], stats: { total: 0, success: 0, errors: 0 } })));
}

async function mockBankingSource(page, tools = [BANKING_TOOL]) {
  await mockBase(page);
  await page.route('**/api/mcp/inspector/profiles**', (r) =>
    r.fulfill(json({ profiles: [], defaultProfileId: '' })),
  );
  await page.route('**/api/mcp/inspector/tools**', (r) =>
    r.fulfill(json({ tools, _source: 'mcp_server' })),
  );
  await page.route('**/api/mcp/inspector/pingone-tools**', (r) =>
    r.fulfill(json({ enabled: false, tools: [], paramDefaults: {} })),
  );
}

async function mockPingOneSource(page, tools = [PINGONE_TOOL]) {
  await mockBase(page);
  await page.route('**/api/mcp/inspector/profiles**', (r) =>
    r.fulfill(json({ profiles: [], defaultProfileId: '' })),
  );
  await page.route('**/api/mcp/inspector/tools**', (r) =>
    r.fulfill(json({ tools: [], _source: 'mcp_server' })),
  );
  await page.route('**/api/mcp/inspector/pingone-tools**', (r) =>
    r.fulfill(json({ enabled: true, tools, paramDefaults: {} })),
  );
}

async function mockCustomSource(page, profiles, tools = [CUSTOM_TOOL]) {
  await mockBase(page);
  await page.route('**/api/mcp/inspector/profiles**', (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill(json({ profile: { id: 'new-1', label: 'New Server' } }));
    }
    return r.fulfill(json({ profiles, defaultProfileId: profiles[0]?.id || '' }));
  });
  await page.route('**/api/mcp/inspector/tools**', (r) =>
    r.fulfill(json({ tools, _source: 'mcp_server' })),
  );
  await page.route('**/api/mcp/inspector/pingone-tools**', (r) =>
    r.fulfill(json({ enabled: false, tools: [], paramDefaults: {} })),
  );
}

// ─── Page structure ───────────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — page structure', () => {
  test('renders the MCP Inspector heading', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await expect(page.getByRole('heading', { name: 'MCP Inspector' })).toBeVisible({ timeout: 15000 });
  });

  test('shows three source pills: AI Demo MCP, PingOne MCP, API Calls', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    // Scope to .source-switcher to avoid matching sidebar nav section headers
    const switcher = page.locator('.source-switcher');
    await expect(switcher.getByRole('button', { name: 'AI Demo MCP' })).toBeVisible({ timeout: 10000 });
    await expect(switcher.getByRole('button', { name: 'PingOne MCP' })).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'API Calls' })).toBeVisible();
  });

  test('loads without uncaught JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// ─── AI Demo MCP source ───────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — AI Demo MCP source', () => {
  test('AI Demo MCP pill is active when ?source=banking', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    const pill = page.locator('.src-pill', { hasText: 'AI Demo MCP' });
    await pill.waitFor({ timeout: 10000 });
    await expect(pill).toHaveClass(/src-pill--active/);
  });

  test('tool name appears in the left tree', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await expect(page.getByText('get_account_balance')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a tool shows its param fields in the middle column', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.getByText('get_account_balance').click();
    await expect(page.getByText('account_id')).toBeVisible({ timeout: 5000 });
  });

  test('Execute posts to /api/mcp/inspector/invoke and renders response', async ({ page }) => {
    await mockBankingSource(page);
    let invokeCalled = false;
    await page.route('**/api/mcp/inspector/invoke', (r) => {
      invokeCalled = true;
      return r.fulfill(json({ balance: 4820.15, currency: 'USD' }));
    });
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.getByText('get_account_balance').click();
    // Use placeholder to target param input (avoids matching sidebar search)
    await page.getByPlaceholder('Account ID').fill('acc_1');
    await page.getByRole('button', { name: 'Execute' }).first().click();
    await expect(page.getByText(/4820/)).toBeVisible({ timeout: 10000 });
    expect(invokeCalled).toBe(true);
  });

  test('Form tab renders response body as labeled key-value fields', async ({ page }) => {
    await mockBankingSource(page);
    await page.route('**/api/mcp/inspector/invoke', (r) =>
      r.fulfill(json({ currency: 'USD', available: 4820.15 })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.getByText('get_account_balance').click();
    await page.getByPlaceholder('Account ID').fill('acc_1');
    await page.getByRole('button', { name: 'Execute' }).first().click();
    await page.getByRole('button', { name: 'Form' }).click();
    await expect(page.getByText('Currency')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('USD')).toBeVisible();
  });

  test('no "+ Add server" control for AI Demo MCP source', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.getByText('get_account_balance').waitFor({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '+ Add server' })).not.toBeVisible();
  });
});

// ─── PingOne MCP source ───────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — PingOne MCP source', () => {
  test('PingOne MCP pill is active by default (no ?source param)', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector');
    // Scope to .source-switcher to avoid sidebar nav button with same name
    const pill = page.locator('.source-switcher .src-pill', { hasText: 'PingOne MCP' });
    await pill.waitFor({ timeout: 10000 });
    await expect(pill).toHaveClass(/src-pill--active/);
  });

  test('shows Connected status and tool count in top bar', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector');
    // PingOne source statusText uses em dash: "Connected — N tools"
    await expect(page.getByText(/Connected — 1 tools/)).toBeVisible({ timeout: 10000 });
  });

  test('PingOne tool name appears in the left tree', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector');
    await expect(page.getByText('GetUserById')).toBeVisible({ timeout: 10000 });
  });

  test('invoking PingOne tool POSTs to /api/mcp/inspector/pingone-invoke', async ({ page }) => {
    await mockPingOneSource(page);
    let called = false;
    await page.route('**/api/mcp/inspector/pingone-invoke', (r) => {
      called = true;
      return r.fulfill(json({ response: { id: 'u1', username: 'alice' }, request: {}, timingsMs: { roundTrip: 8 } }));
    });
    await page.goto('/pingone-mcp-inspector');
    await page.getByText('GetUserById').click();
    // Placeholder is the schema type "string" since no description on user_id
    await page.getByPlaceholder('string').fill('u1');
    await page.getByRole('button', { name: 'Execute' }).first().click();
    await expect(page.getByText(/alice/)).toBeVisible({ timeout: 10000 });
    expect(called).toBe(true);
  });

  test('switching to AI Demo MCP source loads banking tools', async ({ page }) => {
    await mockPingOneSource(page, []);
    await page.route('**/api/mcp/inspector/tools**', (r) =>
      r.fulfill(json({ tools: [BANKING_TOOL], _source: 'mcp_server' })),
    );
    await page.goto('/pingone-mcp-inspector');
    await page.locator('.source-switcher').getByRole('button', { name: 'AI Demo MCP' }).click();
    await expect(page.getByText('get_account_balance')).toBeVisible({ timeout: 10000 });
  });
});

// ─── MFA step-up banner ───────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — MFA step-up', () => {
  test('shows step-up banner when /tools returns mfa_required', async ({ page }) => {
    await mockBase(page);
    await page.route('**/api/mcp/inspector/profiles**', (r) =>
      r.fulfill(json({
        profiles: [{ id: 'default', label: 'AIDemo MCP', isDefault: true }],
        defaultProfileId: 'default',
      })),
    );
    await page.route('**/api/mcp/inspector/tools**', (r) =>
      r.fulfill(json({ tools: [], mfa_required: true, step_up_method: 'email', _source: 'mfa_gate' })),
    );
    await page.route('**/api/mcp/inspector/pingone-tools**', (r) =>
      r.fulfill(json({ enabled: false, tools: [], paramDefaults: {} })),
    );
    await page.goto('/pingone-mcp-inspector?source=custom');
    await expect(page.getByText(/Step-up verification required/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/MFA step-up \(email\)/)).toBeVisible();
  });
});

// ─── Custom Server source ─────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — Custom Server source', () => {
  const PROFILES = [
    { id: 'default', label: 'AIDemo MCP', isDefault: true },
    { id: 'brave', label: 'Brave Search', isDefault: false },
  ];

  test('profile picker lists saved profiles', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    // Profile options are in a native <select>; check select's text content
    const profileSelect = page.locator('select[title="MCP server to inspect"]');
    await expect(profileSelect).toContainText('Brave Search', { timeout: 10000 });
    await expect(profileSelect).toContainText('AIDemo MCP (default)');
  });

  test('"+ Add server" button opens the add-server form', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    await page.locator('select[title="MCP server to inspect"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '+ Add server' }).click();
    await expect(page.getByPlaceholder('Label (e.g. Brave Search)')).toBeVisible({ timeout: 5000 });
  });

  test('saving a new server POSTs to /api/mcp/inspector/profiles', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    let postCalled = false;
    await page.route('**/api/mcp/inspector/profiles', (r) => {
      if (r.request().method() === 'POST') {
        postCalled = true;
        return r.fulfill(json({ profile: { id: 'new-1', label: 'New Server' } }));
      }
      return r.fulfill(json({ profiles: PROFILES, defaultProfileId: 'default' }));
    });
    await page.goto('/pingone-mcp-inspector?source=custom');
    await page.locator('select[title="MCP server to inspect"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '+ Add server' }).click();
    await page.getByPlaceholder('Label (e.g. Brave Search)').fill('New Server');
    await page.getByPlaceholder('Server URL').fill('https://example.com/mcp');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(async () => expect(postCalled).toBe(true)).toPass({ timeout: 5000 });
  });

  test('custom tool appears in the tree', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    await expect(page.getByText('brave_web_search')).toBeVisible({ timeout: 10000 });
  });
});

// ─── API Calls source ─────────────────────────────────────────────────────────

test.describe('PingOne MCP Inspector — API Calls source', () => {
  test('shows captured call URL after switching to API Calls', async ({ page }) => {
    await mockBankingSource(page, []);
    // useApiCallsSource polls /api/api-calls (not /api/mcp/calls)
    await page.route('**/api/api-calls**', (r) =>
      r.fulfill(json({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.locator('.source-switcher').getByRole('button', { name: 'API Calls' }).click();
    await expect(page.getByText('/api/accounts/acc_1')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a captured call shows its response status', async ({ page }) => {
    await mockBankingSource(page, []);
    await page.route('**/api/api-calls**', (r) =>
      r.fulfill(json({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await page.locator('.source-switcher').getByRole('button', { name: 'API Calls' }).click();
    await page.getByText('/api/accounts/acc_1').click();
    // Middle panel shows "Status Code" as a readOnly input — check its value
    const statusInput = page.locator('.inspector-shell-field', { hasText: 'Status Code' }).locator('input');
    await expect(statusInput).toHaveValue('200', { timeout: 5000 });
  });
});
