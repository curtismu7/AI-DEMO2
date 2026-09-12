// Live guard for the session-write class in REGRESSION_PLAN §4: a request that
// writes req.session reverts anything saved while it runs, because
// express-session persists the whole copy it loaded at request START when the
// response ends. Three writers caused the same agent-mode revert in sequence —
// the run's Intent Token, the agent-token cache, and the per-session DPoP
// keypair — and each fix had to be proven HERE, because no unit test can show it.
//
// Why this shape, and why it cannot be simplified:
//
//   * NO browser page. A dashboard session's own boot calls perform the first
//     token exchange, consuming any once-per-session write before a probe can
//     race it — which is exactly why earlier browser probes passed against code
//     that was still broken. loginViaBff gives a session with no page behind it,
//     so the /api/demo-agent/tools call below IS its first exchange.
//   * loginViaBff, not resolveSession: resolveSession returns a cached or
//     LMDB-scavenged session, which has already done its first exchange.
//   * The overlap is PROVEN, not assumed — the test fails if the mode switch did
//     not land while /tools was still in flight, rather than passing vacuously.
//
// Run: cd demo_api_ui && E2E_BASE_URL=https://local.ping-devops.com:4000 \
//        npx playwright test --config playwright.real.config.js first-exchange-dpop
const path = require('path');
const { test, expect } = require('@playwright/test');

// Repo-relative: demo_api_ui/tests/e2e -> repo root -> demo_api_server/...
const SESSION_HELPER = path.resolve(
  __dirname,
  '../../../demo_api_server/tests/real/helpers/session.js',
);

test('a mode change survives the first token exchange of a session', async ({ playwright }) => {
  test.setTimeout(240_000);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { loginViaBff } = require(SESSION_HELPER);

  const username = process.env.DEMO_USER_USERNAME || process.env.E2E_CUSTOMER_USERNAME;
  const password = process.env.DEMO_USER_PASSWORD || process.env.E2E_CUSTOMER_PASSWORD;
  expect(username && password, 'DEMO_USER_* / E2E_CUSTOMER_* must be set').toBeTruthy();

  const sid = await loginViaBff({
    envId: process.env.PINGONE_ENVIRONMENT_ID,
    region: process.env.PINGONE_REGION || 'com',
    username,
    password,
    loginPath: '/api/auth/oauth/user/login',
    callbackPath: '/api/auth/oauth/user/callback',
  });

  const base = process.env.E2E_BASE_URL || 'https://local.ping-devops.com:4000';
  const ctx = await playwright.request.newContext({
    baseURL: base,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: sid },
  });

  try {
    // Never trust an API cookie silently — an unauthenticated session would make
    // every assertion below pass for the wrong reason.
    const authed = await (await ctx.get('/api/auth/session')).json();
    expect(authed.authenticated, 'API cookie did not produce a signed-in session').toBe(true);

    const status = async () => (await ctx.get('/api/langchain/config/status')).json();
    const setMode = async (mode) => {
      const res = await ctx.post('/api/langchain/config', { data: { agent_mode: mode } });
      expect(res.ok(), `set mode ${mode}`).toBe(true);
    };

    const before = await status();

    try {
      await setMode('llamacpp');
      expect((await status()).provider).toBe('llamacpp');

      const t0 = Date.now();
      const secs = (ms) => ((ms - t0) / 1000).toFixed(2);
      // This session's FIRST token exchange — the request under test.
      const toolsPromise = ctx.post('/api/demo-agent/tools', {
        data: { vertical: 'sporting-goods', allowWrite: false },
      });
      await new Promise((r) => setTimeout(r, 150));

      await setMode('claude');
      const switchedAt = Date.now();
      const switched = (await status()).provider;
      expect(switched).not.toBe('llamacpp');

      const toolsRes = await toolsPromise;
      const toolsEndedAt = Date.now();
      const toolsBody = await toolsRes.json().catch(() => ({}));
      // .type, not .id: these come from agentSessionMiddleware's
      // recordTokenEvent(type, ...), not from buildTokenEvent — see the note below.
      const eventTypes = (toolsBody.tokenEvents || []).map((e) => e.type);
      console.log(
        `[first-exchange] /tools http=${toolsRes.status()} ended=${secs(toolsEndedAt)}s ` +
        `switch=${secs(switchedAt)}s overlapped=${switchedAt < toolsEndedAt} ` +
        `tools=${(toolsBody.availableTools || []).length} degraded=${!!toolsBody.degraded} ` +
        `events=${eventTypes.join(',')}`,
      );
      expect(
        switchedAt < toolsEndedAt,
        'the switch did not land while /tools was in flight — this run proves nothing',
      ).toBe(true);

      // Without these, a SLOW PRE-EXCHANGE FAILURE (delayed token check, scope
      // refusal, config error) would stay in flight across the switch, satisfy
      // the overlap check, and pass — while no session write ever happened. The
      // guard would then report "fixed" against broken code, which is the one
      // outcome that makes it worthless.
      //
      // resolveAvailableTools MINTS the delegated token before discovery and
      // THROWS on failure (need_auth / discovery_token_failed / blocked), which
      // the route turns into 401/403/502. So a 200 with tools in the body is
      // proof the request reached and completed the exchange — the write under
      // test happens on that path.
      //
      // Deliberately NOT asserted: the 'dpop-binding' token event. It is built
      // into the array passed to agentMcpTokenService, but resolveAvailableTools
      // returns `req.tokenEvents` — a DIFFERENT array, filled by
      // agentSessionMiddleware's recordTokenEvent(type, ...) — so that event
      // never reaches this response. Same two-array trap documented in
      // agentRun.js. Don't re-add it; assert on the status + tools instead.
      expect(toolsRes.ok(), `/tools failed (HTTP ${toolsRes.status()}) — no exchange ran`).toBe(true);
      expect(
        (toolsBody.availableTools || []).length,
        'no tools discovered — /tools did not complete the exchange + discovery path',
      ).toBeGreaterThan(0);

      const after = (await status()).provider;
      console.log(`[first-exchange] switched=${switched} after=${after}`);
      // The failure mode: `after` comes back as the value from BEFORE the switch,
      // i.e. the session exactly as /tools loaded it.
      expect(after).toBe(switched);
    } finally {
      await setMode(before.agent_mode || 'heuristics');
    }
  } finally {
    await ctx.dispose();
  }
});
