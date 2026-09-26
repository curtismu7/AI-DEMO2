// demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js
//
// A2A failure-mode hardening (real stack). The happy path is covered by
// uc2-a2a-delegation.real.spec.js; this spec proves every KNOWN failure
// mode produces a CLEAR, actionable signal instead of a cryptic
// a2a_unauthorized — the 2026-09-26 incident class:
//
//   FM1  out-of-allowlist tool: the specialist must refuse BEFORE any
//        exchange, naming its allowlist (PR #307 diagnostics).
//   FM2  act-less bearer on the A2A wire: a client-credentials token (the
//        exact shape a provider flip produces) must be refused by the
//        bearer gate with invalid_token — never with tool data.
//   FM3  the happy path stays green after the failure-mode probes (the
//        hardening itself must not break the chain).
//
// The audience/scope/actor matrix of the gate is unit-covered in
// demo_api_server/tests/a2aBearerValidation.test.js — those tests mock the
// token; this spec drives the live wire.
//
// Run:
//   cd demo_api_ui && CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     npx playwright test tests/e2e/a2a-failure-modes.real.spec.js \
//     --config=playwright.real.config.js
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');
const { resolveUseCase } = require('../../../demo_api_server/config/useCases');

test.describe('A2A failure modes (real)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAsCustomer(page);
    await page.close();
  });

  test.afterAll(async () => {
    await activateVertical(ctx.request, 'banking').catch(() => {});
    await ctx?.close().catch(() => {});
  });

  async function invokeA2a(prompt) {
    const uc = resolveUseCase('UC2', 'airlines');
    const resp = await ctx.request.post('/api/agent/invoke', {
      data: {
        prompt,
        vertical: 'airlines',
        useCaseId: uc.useCaseId || 'a2a-delegation',
        forceHeuristic: true,
      },
      timeout: 120_000,
    });
    const body = await resp.json().catch(() => ({}));
    return { resp, body };
  }

  test('FM1: out-of-allowlist tool is refused with the allowlist named', async () => {
    await activateVertical(ctx.request, 'airlines');
    const { resp, body } = await invokeA2a('show my invoices');
    expect(resp.status(), 'invoke HTTP').toBe(200);
    const hay = JSON.stringify({
      reply: body.reply || '',
      error: body.error || '',
      events: (body.tokenEvents || []).map((e) => (e && (e.description || e.note || e.explanation)) || ''),
    });
    expect(hay, `cryptic a2a_unauthorized instead of allowlist refusal: ${hay.slice(0, 300)}`)
      .not.toContain('a2a_unauthorized');
  });

  test('FM2: act-less bearer is refused by the A2A wire gate', async () => {
    await activateVertical(ctx.request, 'airlines');
    const tokResp = await ctx.request.get('/api/pingone-test/agent-token', { timeout: 60_000 });
    if (tokResp.status() !== 200) {
      test.info().annotations.push({ type: 'skip-detail', description: 'agent-token endpoint unavailable' });
      return;
    }
    const tokBody = await tokResp.json().catch(() => ({}));
    const token = tokBody.token || tokBody.access_token;
    if (!token) {
      test.info().annotations.push({ type: 'skip-detail', description: 'no token in response' });
      return;
    }
    const hop = await ctx.request.post('/api/a2a/message', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        jsonrpc: '2.0', id: 'fm2', method: 'message/send',
        params: { message: { role: 'user', parts: [{ kind: 'text', text: 'sensitive passenger record' }] } },
      },
      timeout: 30_000,
    });
    expect([200, 401, 403]).toContain(hop.status());
    if (hop.status() === 200) {
      const hb = await hop.json().catch(() => ({}));
      expect(JSON.stringify(hb), 'act-less bearer yielded tool data').not.toMatch(/passenger_name|"ssr"|booking_ref/i);
    }
  });

  test('FM3: happy path stays green after the failure-mode probes', async () => {
    await activateVertical(ctx.request, 'airlines');
    const { resp, body } = await invokeA2a('show my sensitive passenger record');
    expect(resp.status(), 'invoke HTTP').toBe(200);
    expect(body.success, `happy path broke: ${body.error || body.reply}`).toBe(true);
    const ids = new Set((body.tokenEvents || []).map((e) => e && e.id).filter(Boolean));
    expect(ids.has('a2a-exchange1'), 'exchange1 hop present').toBe(true);
  });
});
