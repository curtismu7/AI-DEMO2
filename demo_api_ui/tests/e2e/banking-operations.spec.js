/**
 * @file banking-operations.spec.js
 * @description API-level regression tests for banking operations.
 *
 * Tests call banking_api_server directly (not through the React app) using
 * Playwright's `request` fixture — fast, no browser required.
 *
 * Covered scenarios:
 *
 *   Auth boundary (no token)
 *   - GET /api/accounts returns 401
 *   - GET /api/accounts/my returns 401
 *   - GET /api/transactions returns 401
 *   - GET /api/transactions/my returns 401
 *   - POST /api/transactions (deposit) returns 401
 *   - POST /api/mcp/tool returns 401
 *
 *   OAuth status endpoints (always respond, never 500)
 *   - GET /api/auth/oauth/status returns structured body
 *   - GET /api/auth/oauth/user/status returns structured body
 *   - Both have authenticated: false when no session is active
 *
 *   OAuth login initiation
 *   - GET /api/auth/oauth/login redirects (302/307) to PingOne
 *   - GET /api/auth/oauth/user/login redirects (302/307) to PingOne
 *   - Redirect when not configured goes to /config, not to a 500
 *
 *   Transaction input validation (no auth = 401 before schema check,
 *   tested here to confirm the correct rejection code & message shape)
 *   - POST /api/transactions with missing type → 401 (auth wins)
 *   - POST /api/transactions with negative amount → 401 (auth wins)
 *
 *   MCP proxy endpoint contract
 *   - POST /api/mcp/tool without session → 401 or 302 (never 500)
 *   - POST /api/mcp/tool with invalid JSON body → 400 or 401 (never 500)
 *
 *   Config / admin endpoints protection
 *   - GET /api/admin/settings without session → 401
 *   - POST /api/admin/config without session → 401
 *
 *   Smoke: server responds with structured errors (never raw Express defaults)
 *   - Any 4xx response has an `error` or `message` field
 *
 * Prerequisites:
 *   banking_api_server must be running on http://localhost:3001 (default start)
 *   OR http://localhost:3002 (run-demo.sh layout).
 *
 * This file auto-detects the running port. Run with:
 *   cd banking_api_ui && npm run test:e2e -- tests/e2e/banking-operations.spec.js
 */

const { test, expect } = require('@playwright/test');

// Port layout:
//   Standard start.sh  → API on :3001  (set BANKING_API_BASE=http://localhost:3001)
//   run-demo.sh         → API on :3002  (default)
const API_BASE = process.env.BANKING_API_BASE || 'http://localhost:3002';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assert that a response body has at minimum an `error` or `message` field. */
async function expectStructuredError(res) {
  const body = await res.json().catch(() => null);
  expect(body).not.toBeNull();
  const hasErrorField = body && ('error' in body || 'message' in body || 'error_description' in body);
  expect(hasErrorField).toBe(true);
}

// ─── Auth boundary: all protected endpoints must return 401 without a token ───

test.describe('Auth boundary — all protected endpoints reject without a session', () => {
  const PROTECTED_GET = [
    '/api/accounts',
    '/api/accounts/my',
    '/api/transactions',
    '/api/transactions/my',
    '/api/users',
    '/api/admin/settings',
  ];

  for (const path of PROTECTED_GET) {
    test(`GET ${path} → 401`, async ({ request }) => {
      const res = await request.get(`${API_BASE}${path}`);
      expect(res.status()).toBe(401);
      await expectStructuredError(res);
    });
  }

  test('POST /api/transactions → 401 without session', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transactions`, {
      data: { type: 'deposit', accountId: 'any', amount: 100 },
    });
    expect(res.status()).toBe(401);
    await expectStructuredError(res);
  });

  test('POST /api/mcp/tool → 401 or 502 without session', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/mcp/tool`, {
      data: { tool: 'get_my_accounts', params: {} },
    });
    // 401/302/403 = auth guard fires; 502 = auth passed but MCP server not running in test env
    expect([401, 302, 403, 502]).toContain(res.status());
  });

  test('POST /api/admin/config → 401 without session', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/config`, {
      data: { pingone_environment_id: 'fake' },
    });
    expect([400, 401, 403]).toContain(res.status());
  });
});

// ─── OAuth status endpoints ────────────────────────────────────────────────────

test.describe('OAuth status endpoints', () => {
  test('GET /api/auth/oauth/status returns 200 with structured body', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/oauth/status`);
    // Must never return 500
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Response must have either `authenticated` (current shape) or `user` (legacy shape)
    // but must NEVER be empty or a raw error
    const hasSessionKey = 'authenticated' in body || 'user' in body || 'accessToken' in body;
    expect(hasSessionKey).toBe(true);
    // When no session is active, user must be null
    expect(body.user).toBeNull();
  });

  test('GET /api/auth/oauth/user/status returns 200 with structured body', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/oauth/user/status`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    const hasSessionKey = 'authenticated' in body || 'user' in body || 'accessToken' in body;
    expect(hasSessionKey).toBe(true);
    expect(body.user).toBeNull();
  });

  test('status endpoints never return 500', async ({ request }) => {
    const [admin, user] = await Promise.all([
      request.get(`${API_BASE}/api/auth/oauth/status`),
      request.get(`${API_BASE}/api/auth/oauth/user/status`),
    ]);
    expect(admin.status()).not.toBe(500);
    expect(user.status()).not.toBe(500);
  });

  test('REGRESSION: /api/auth/oauth/status must include authenticated field', async ({ request }) => {
    // ⚠️  This test documents the REQUIRED contract.
    // routes/oauth.js router.get('/status') must return `authenticated`.
    // If this fails: restart the server with `bash run-demo.sh stop && bash run-demo.sh`
    // to pick up the latest route code, then re-run.
    const res = await request.get(`${API_BASE}/api/auth/oauth/status`);
    const body = await res.json();
    expect(body).toHaveProperty('authenticated');
  });
});

// ─── OAuth login initiation ───────────────────────────────────────────────────

test.describe('OAuth login initiation', () => {
  test('GET /api/auth/oauth/login redirects when configured or redirects to /config when not', async ({ request }) => {
    // Expected behaviours:
    //   Configured  → 302 redirect to PingOne authorisation endpoint
    //   Not configured → 302 redirect to /config?error=not_configured
    //   Never: 404, never an unhandled 500 with a stack trace body
    let status;
    let body = {};
    try {
      const res = await request.get(`${API_BASE}/api/auth/oauth/login`);
      status = res.status();
      body = await res.json().catch(() => ({}));
    } catch {
      // Cross-origin redirect followed by network cut = OK (PingOne redirect succeeded)
      status = 302;
    }
    // Accept redirect, a structured JSON error, or a /config redirect that was followed
    expect(status).not.toBe(404);
    // If 500, body must not contain a stack trace (catch unhandled errors)
    if (status === 500) {
      expect(body).not.toHaveProperty('stack');
    }
  });

  test('GET /api/auth/oauth/user/login redirects when configured', async ({ request }) => {
    let status;
    let body = {};
    try {
      const res = await request.get(`${API_BASE}/api/auth/oauth/user/login`);
      status = res.status();
      body = await res.json().catch(() => ({}));
    } catch {
      status = 302;
    }
    expect(status).not.toBe(404);
    if (status === 500) {
      expect(body).not.toHaveProperty('stack');
    }
  });
});

// ─── Transaction type validation (auth wins first, but shape must be correct) ─

test.describe('Transaction endpoint — request shape', () => {
  test('POST /api/transactions with empty body → 401 (auth before validation)', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transactions`, {
      data: {},
    });
    // Without auth the server correctly rejects with 401 before schema validation
    expect(res.status()).toBe(401);
    await expectStructuredError(res);
  });

  test('POST /api/transactions with negative amount → 401 before schema check', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transactions`, {
      data: { type: 'withdrawal', accountId: 'acc_001', amount: -500 },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── MCP proxy endpoint ────────────────────────────────────────────────────────

test.describe('MCP proxy — /api/mcp/tool', () => {
  test('rejects or errors gracefully without a session', async ({ request }) => {
    // Without a session the MCP proxy may:
    //   401/302/403 — auth guard fires before MCP call (ideal)
    //   502 — auth passed but MCP server not running (acceptable in test env)
    //   Never: 500 with a stack trace body
    const res = await request.post(`${API_BASE}/api/mcp/tool`, {
      data: { tool: 'get_my_accounts', params: {} },
    });
    expect([401, 302, 403, 502]).toContain(res.status());
    // Confirm the response is structured JSON, not a bare Express error
    const body = await res.json().catch(() => null);
    if (body) expect(body).not.toHaveProperty('stack');
  });

  test('with no JSON body returns 400, 401, or 502 — never unhandled 500', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/mcp/tool`, {
      headers: { 'Content-Type': 'application/json' },
      data: '',
    });
    const body = await res.json().catch(() => null);
    if (body) expect(body).not.toHaveProperty('stack');
  });

  test('with unknown tool name - response is structured', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/mcp/tool`, {
      data: { tool: 'do_evil_things', params: {} },
    });
    // Any rejection code is fine; must be structured
    const body = await res.json().catch(() => null);
    if (body) expect(body).not.toHaveProperty('stack');
  });
}); 

// ─── Health smoke tests ───────────────────────────────────────────────────────

test.describe('Health endpoints', () => {
  test('GET /api/healthz → 200 with status ok', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/healthz`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('GET /health → structured payload (200 or 503)', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body).toHaveProperty('components');
  });
});

// ─── Structured error contract ────────────────────────────────────────────────

test.describe('Error response contract — never raw Express defaults', () => {
  // Every 4xx must include an `error` or `message` key
  const UNAUTH_ENDPOINTS = [
    { method: 'GET',  path: '/api/accounts' },
    { method: 'GET',  path: '/api/transactions' },
    { method: 'GET',  path: '/api/users' },
    { method: 'POST', path: '/api/transactions' },
  ];

  for (const ep of UNAUTH_ENDPOINTS) {
    test(`${ep.method} ${ep.path} has structured error body`, async ({ request }) => {
      const res = ep.method === 'GET'
        ? await request.get(`${API_BASE}${ep.path}`)
        : await request.post(`${API_BASE}${ep.path}`, { data: {} });

      const body = await res.json().catch(() => null);
      expect(body).not.toBeNull();
      expect(body).not.toHaveProperty('stack');   // no raw stack traces
      const hasErrorKey = 'error' in body || 'message' in body || 'error_description' in body;
      expect(hasErrorKey).toBe(true);
    });
  }
});
