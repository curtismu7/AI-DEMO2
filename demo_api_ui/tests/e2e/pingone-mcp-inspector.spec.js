/**
 * @file pingone-mcp-inspector.spec.js
 * @description Playwright E2E tests for the unified MCP Inspector page
 * (/pingone-mcp-inspector, McpInspectorPageClean on the shared InspectorLayout).
 *
 * Page anatomy these tests rely on: one <select id="insp-source"> (labelled
 * "Server") picks the source; a searchable tools table lists the tools; the
 * picked tool's parameters are labelled inputs next to a "Send" button; a
 * finished call shows "What the tool returned" and a Calls list.
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
  duration: 38,
  timestamp: '2026-11-10T12:00:00.000Z',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sourceSelect = (page) => page.locator('#insp-source');
const toolRow = (page, name) => page.locator('.insp-tools__pick', { hasText: new RegExp(`^${name}$`) });

// ─── Page structure ───────────────────────────────────────────────────────────

test.describe('MCP Inspector — page structure', () => {
  test('renders the MCP Inspector heading', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await expect(page.getByRole('heading', { level: 1, name: 'MCP Inspector' })).toBeVisible({ timeout: 15000 });
  });

  test('the Server picker offers AI Demo MCP, PingOne MCP and All API calls', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    const picker = sourceSelect(page);
    await expect(picker).toBeVisible({ timeout: 10000 });
    await expect(page.locator('label[for="insp-source"]')).toHaveText('Server');
    for (const label of ['AI Demo MCP', 'PingOne MCP', 'All API calls']) {
      await expect(picker.locator('option', { hasText: label })).toHaveCount(1);
    }
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

test.describe('MCP Inspector — AI Demo MCP source', () => {
  test('AI Demo MCP is the selected Server when ?source=banking', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await expect(sourceSelect(page)).toHaveValue('banking', { timeout: 10000 });
  });

  test('AI Demo MCP is the default Server when there is no ?source param', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector');
    await expect(sourceSelect(page)).toHaveValue('banking', { timeout: 10000 });
  });

  test('tool name appears in the tools table', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await expect(toolRow(page, 'get_account_balance')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a tool shows its param fields', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await toolRow(page, 'get_account_balance').click();
    // Required params carry a trailing " *" in the label.
    await expect(page.getByLabel(/^account_id/)).toBeVisible({ timeout: 5000 });
  });

  test('Send posts to /api/mcp/inspector/invoke and renders the response', async ({ page }) => {
    await mockBankingSource(page);
    let invokeCalled = false;
    await page.route('**/api/mcp/inspector/invoke', (r) => {
      invokeCalled = true;
      return r.fulfill(json({ balance: 4820.15, currency: 'USD' }));
    });
    await page.goto('/pingone-mcp-inspector?source=banking');
    await toolRow(page, 'get_account_balance').click();
    await page.getByPlaceholder('Account ID').fill('acc_1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tool output data' }).getByText(/4820/).first()).toBeVisible({ timeout: 10000 });
    expect(invokeCalled).toBe(true);
  });

  test('the tool result is shown as labeled key-value fields', async ({ page }) => {
    await mockBankingSource(page);
    await page.route('**/api/mcp/inspector/invoke', (r) =>
      r.fulfill(json({ currency: 'USD', available: 4820.15 })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await toolRow(page, 'get_account_balance').click();
    await page.getByPlaceholder('Account ID').fill('acc_1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const data = page.getByRole('region', { name: 'Tool output data' });
    await expect(data.getByText('Currency')).toBeVisible({ timeout: 10000 });
    await expect(data.getByText('USD')).toBeVisible();
  });

  test('no "+ Add server" control for AI Demo MCP source', async ({ page }) => {
    await mockBankingSource(page);
    await page.goto('/pingone-mcp-inspector?source=banking');
    await toolRow(page, 'get_account_balance').waitFor({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '+ Add server' })).not.toBeVisible();
  });
});

// ─── PingOne MCP source ───────────────────────────────────────────────────────

test.describe('MCP Inspector — PingOne MCP source', () => {
  test('PingOne MCP is the selected Server when ?source=pingone', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector?source=pingone');
    await expect(sourceSelect(page)).toHaveValue('pingone', { timeout: 10000 });
  });

  test('shows the Live chip and the tool count', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector?source=pingone');
    await expect(page.locator('.insp-tools__count')).toHaveText('1 tools', { timeout: 10000 });
    await expect(page.locator('.insp-hero-meta').getByText('Live', { exact: true })).toBeVisible();
  });

  test('PingOne tool name appears in the tools table', async ({ page }) => {
    await mockPingOneSource(page);
    await page.goto('/pingone-mcp-inspector?source=pingone');
    await expect(toolRow(page, 'GetUserById')).toBeVisible({ timeout: 10000 });
  });

  test('invoking PingOne tool POSTs to /api/mcp/inspector/pingone-invoke', async ({ page }) => {
    await mockPingOneSource(page);
    let called = false;
    await page.route('**/api/mcp/inspector/pingone-invoke', (r) => {
      called = true;
      return r.fulfill(json({ response: { id: 'u1', username: 'alice' }, request: {}, timingsMs: { roundTrip: 8 } }));
    });
    await page.goto('/pingone-mcp-inspector?source=pingone');
    await toolRow(page, 'GetUserById').click();
    // The placeholder is the schema type ("string") since user_id has no description.
    await page.getByLabel(/^user_id/).fill('u1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tool output data' }).getByText(/alice/).first()).toBeVisible({ timeout: 10000 });
    expect(called).toBe(true);
  });

  test('switching the Server to AI Demo MCP loads banking tools', async ({ page }) => {
    await mockPingOneSource(page, []);
    await page.route('**/api/mcp/inspector/tools**', (r) =>
      r.fulfill(json({ tools: [BANKING_TOOL], _source: 'mcp_server' })),
    );
    await page.goto('/pingone-mcp-inspector?source=pingone');
    await sourceSelect(page).selectOption('banking');
    await expect(toolRow(page, 'get_account_balance')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Custom Server source ─────────────────────────────────────────────────────

test.describe('MCP Inspector — Custom Server source', () => {
  const PROFILES = [
    { id: 'default', label: 'AIDemo MCP', isDefault: true },
    { id: 'brave', label: 'Brave Search', isDefault: false },
  ];
  const profileSelect = (page) => page.getByLabel('Server profile');

  test('profile picker lists saved profiles', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    await expect(profileSelect(page).locator('option', { hasText: 'Brave Search' })).toHaveCount(1, { timeout: 10000 });
    await expect(profileSelect(page).locator('option', { hasText: 'AIDemo MCP' })).toHaveCount(1);
  });

  test('"+ Add server" button opens the add-server form', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    await profileSelect(page).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '+ Add server' }).click();
    await expect(page.getByPlaceholder('e.g. Staging MCP server')).toBeVisible({ timeout: 5000 });
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
    await profileSelect(page).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '+ Add server' }).click();
    await page.getByPlaceholder('e.g. Staging MCP server').fill('New Server');
    await page.getByPlaceholder('https://example.test/mcp').fill('https://example.com/mcp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(async () => expect(postCalled).toBe(true)).toPass({ timeout: 5000 });
  });

  test('custom tool appears in the tools table', async ({ page }) => {
    await mockCustomSource(page, PROFILES);
    await page.goto('/pingone-mcp-inspector?source=custom');
    await expect(toolRow(page, 'brave_web_search')).toBeVisible({ timeout: 10000 });
  });
});

// ─── All API calls source ─────────────────────────────────────────────────────

test.describe('MCP Inspector — All API calls source', () => {
  const callsList = (page) => page.getByRole('complementary', { name: 'Calls' });

  test('shows the captured call URL after switching to All API calls', async ({ page }) => {
    await mockBankingSource(page, []);
    // useInspectorSource polls /api/api-calls (not /api/mcp/calls)
    await page.route('**/api/api-calls**', (r) =>
      r.fulfill(json({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await sourceSelect(page).selectOption('api');
    await expect(callsList(page).getByText('/api/accounts/acc_1')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a captured call shows its response status', async ({ page }) => {
    await mockBankingSource(page, []);
    await page.route('**/api/api-calls**', (r) =>
      r.fulfill(json({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } })),
    );
    await page.goto('/pingone-mcp-inspector?source=banking');
    await sourceSelect(page).selectOption('api');
    await callsList(page).getByText('/api/accounts/acc_1').click();
    // The call detail header carries the status chip ("200") for the selected call.
    const detail = page.locator('.insp-detail');
    await expect(detail.getByRole('heading', { name: /GET \/api\/accounts\/acc_1/ })).toBeVisible({ timeout: 5000 });
    await expect(detail.locator('.insp-detail-head .insp-chip', { hasText: '200' })).toBeVisible();
  });
});
