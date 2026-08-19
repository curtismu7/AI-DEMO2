// Targeted live check for demo steps 7 (UC2) and 8 (UC2.5): A2A delegation
// must complete against the CURRENT deployment config (PG gateway flag + real
// authorize left as-is). Sends forceHeuristic:true — the same mechanism the
// SPA uses for chips — so "hand off to a specialist" maps to the
// delegate_to_specialist fast-path deterministically even though the
// container's AGENT_MODE env pins an LLM mode (LLM paraphrase flake is a
// separate known issue, not what this spec guards). Guards the
// mcpGatewayClient A2A-audience pin (#610): before it, the specialist's
// get_portfolio_summary always failed with mcp_error on the PingGateway path.
'use strict';

const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');

test.describe('A2A delegation demo steps (live, current flags)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAsCustomer(page);
    // The session cookie can land a beat after /dashboard renders — poll until
    // the request context is actually authenticated.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const s = await ctx.request.get('/api/auth/oauth/user/status').catch(() => null);
      if (s && s.ok()) {
        const j = await s.json().catch(() => ({}));
        if (j.authenticated) break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    await page.close();

    // The delegation heuristic lives in the A2A overlay, always merged for
    // specialist verticals (ff_a2a_delegation was removed — delegation is
    // unconditional). ff_heuristic_enabled=true is a deployment invariant
    // (agent-demo-triage).
    const arm = await ctx.request.patch('/api/admin/feature-flags', {
      data: { updates: { ff_heuristic_enabled: true } },
    });
    expect(arm.ok(), 'arm ff_heuristic_enabled').toBe(true);
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => {});
  });

  test('"hand off to a specialist" delegates and the specialist tool call succeeds', async () => {
    await activateVertical(ctx.request, 'banking');
    const resp = await ctx.request.post('/api/agent/invoke', {
      data: { prompt: 'hand off to a specialist', vertical: 'banking', forceHeuristic: true },
      timeout: 120_000,
    });
    expect(resp.status(), 'invoke status').toBe(200);
    const body = await resp.json();
    const reply = String(body.reply || '');
    console.log(`[debug] reply: ${reply.slice(0, 300)}`);
    expect(reply.length, 'non-empty reply').toBeGreaterThan(0);
    // Before #610 this path returned "❌ Delegated to Investment Advisor, but
    // get_portfolio_summary failed: mcp_error".
    expect(reply, 'no failure marker').not.toMatch(/❌|mcp_error|failed/i);
    expect(reply, 'delegation completed').toMatch(/Delegation complete/i);
  });
});
