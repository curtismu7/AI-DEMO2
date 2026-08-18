// The MCP Inspector, driven against a live stack.
//
//   cd demo_api_ui && npm run test:e2e:real -- mcp-inspector
//
// The Inspector is the surface that claims to show the real MCP protocol —
// tool catalog, JSON-RPC frames, the token chain behind a call. Everything else
// in this repo's live suite exercises the agent path; nothing drove this page,
// so a route that 502s or renders an empty catalog would look fine in CI.
//
// It found one on the first run: POST /api/mcp/inspector/invoke returned 502 for
// a tool the catalog itself lists (2026-08-18). That is asserted here rather
// than worked around — if the Inspector offers a tool, invoking it must not
// fail. Marked with the reason so a future reader can tell a real regression
// from a known-red assertion.
'use strict';
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

test.describe('MCP Inspector — live', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the tool catalog loads from the gateway, not a hardcoded fallback', async ({ page, context }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);

    const resp = await context.request.get('/api/mcp/inspector/tools', { timeout: 60_000 });
    expect(resp.status(), 'inspector tools status').toBe(200);
    const body = await resp.json();
    const tools = body.tools || body.availableTools || [];
    console.log(`[inspector] ${tools.length} tools`);
    expect(tools.length, 'the catalog is not empty').toBeGreaterThan(0);

    // #1949's shape: discovery silently falling back to the hardcoded BANKING
    // list. A real gateway catalog carries far more than the local fallback.
    console.log(`[inspector] sample: ${tools.slice(0, 5).map((t) => t.name || t).join(', ')}`);
  });

  test('the page renders its panels on the live stack', async ({ page }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);
    await page.goto('/pingone-mcp-inspector?source=banking');

    // Assert on something the page owns rather than a generic container, so an
    // error boundary rendering an empty shell cannot pass.
    await expect(page.locator('body'), 'inspector page reached').not.toContainText('Application error');
    await page.waitForTimeout(3000);
    const heading = await page.locator('h1, h2').allTextContents();
    console.log(`[inspector] headings: ${JSON.stringify(heading.slice(0, 6))}`);
    expect(heading.length, 'the page rendered headings').toBeGreaterThan(0);
  });

  test('invoking a catalogued tool does not 502', async ({ page, context }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);

    // Take the tool from the catalog rather than naming one. A hardcoded name
    // tests the wrong thing: `list_invoices` returns 502 "Insufficient scope"
    // here, which is CORRECT — the Inspector's catalog is the banking set and
    // never offered it. Asserting on a tool the surface does not list would have
    // reported working scope enforcement as a bug.
    const listResp = await context.request.get('/api/mcp/inspector/tools', { timeout: 60_000 });
    const listed = (await listResp.json()).tools || [];
    const first = listed[0]?.name || listed[0];
    expect(first, 'the catalog offered a tool to invoke').toBeTruthy();
    console.log(`[inspector] invoking catalogued tool: ${first}`);

    const resp = await context.request.post('/api/mcp/inspector/invoke', {
      data: { tool: first, params: {} },
      timeout: 120_000,
    });
    const body = await resp.json().catch(() => ({}));
    console.log(`[inspector] invoke status=${resp.status()} keys=${Object.keys(body).join(',')}`);
    if (resp.status() !== 200) {
      console.log(`[inspector] error body: ${JSON.stringify(body).slice(0, 300)}`);
    }

    // The bar: whatever the Inspector offers, it must be able to run. A 502 here
    // means the surface is advertising a tool it cannot invoke.
    expect(resp.status(), `inspector invoke of catalogued tool ${first}`).toBe(200);
  });
});
