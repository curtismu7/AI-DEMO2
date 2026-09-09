// demo_api_ui/tests/e2e/demo-steps-outcomes.real.spec.js
'use strict';
/**
 * Demo Steps outcome check — every step in the presenter dropdown must
 * produce its DECLARED outcome, signed in and signed out.
 *
 * Earlier suites asserted "not the catalog card" or an HTTP status, which is
 * why every bug in the 2026-09-08 review was invisible. This spec asserts the
 * outcome the catalog declares (`expectedOutcome`, `stepUpMethod`, `auth`) for
 * the exact step list the dropdown renders (`DEMO_PRIMARY_USE_CASE_IDS`), so
 * it cannot drift from the UI.
 *
 * Dispatch mirrors AIAgent.handleDemoStepSelect per trigger type:
 *   chip   → POST /api/agent/invoke (forceHeuristic, same as stepVerification)
 *   attack → POST /api/demo/attack-sim/run, scored by attackSimVerdict
 *   UC14b  → POST /api/demo/intent-binding/run (the dropdown's "quick result")
 *   link   → the page renders its heading with no page errors
 * Flags: the SPA arms requiredFlagsForUseCase() for signed-in non-public
 * steps; we do the same and restore what we changed. Nothing else is toggled.
 *
 * Verticals: default = the verified list in VERTICALS. Run another with
 *   E2E_DEMO_STEPS_VERTICALS=airlines,investment
 * (catalog-only assertions until its `verified` flag is flipped).
 *
 * Run (stack up, ~4 min for the four verified verticals):
 *   cd demo_api_ui && E2E_BASE_URL=https://local.ping-devops.com:4000 \
 *     npm run test:e2e:real:demo-steps
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');
// ESM sources, dependency-free — Node >= 22.12 require(esm).
const { DEMO_PRIMARY_USE_CASE_IDS } = require('../../src/config/demoUseCaseSteps.js');
const { attackSimVerdict } = require('../../src/utils/attackSimVerdict.js');
const { requiredFlagsForUseCase } = require('../../src/utils/requiredDemoFlags.js');
const { runsSignedOut } = require('../../src/utils/useCaseAuth.js');

/**
 * Per-vertical expectations layered on the catalog. `reply` regexes pin the
 * content a PERMIT must carry (a 200 with the wrong answer is still a bug).
 * `verified: true` means every row below was confirmed against the running
 * stack; an unverified vertical runs catalog-only assertions and only when
 * named in E2E_DEMO_STEPS_VERTICALS. Flip it after a live run, never before.
 */
const VERTICALS = {
  'sporting-goods': {
    verified: true,
    reply: {
      UC24: /store/i,
      UC1: /Purchases|gear/i,
      UC20: /Purchases|gear/i,
      UC2: /Delegation complete/i,
      'UC2.5': /Delegation complete/i,
      UC30: /Austin/,
      UC31: /Miami/,
    },
  },
  // Confirmed live 2026-09-09 (90/90 across the three, signed in and out). No
  // `reply` table yet — these run the catalog's declared-outcome assertions
  // only; add per-use-case reply regexes as each vertical's copy is pinned.
  'abercrombie-fitch': { verified: true },
  investment: { verified: true },
  airlines: { verified: true },
};

/** Link steps: text that proves the page rendered, not just the app shell. */
const PAGE_HEADING = {
  '/a2a-protocol-learning': 'Agent-to-Agent (A2A), end to end',
  '/agent-gateway-capabilities': 'Agent Gateway Inspector',
  '/demo/enterprise-mcp': 'Enterprise-Managed MCP Authorization',
  '/personal-agent': 'Personal Agent',
};

const RUN_VERTICALS = (
  process.env.E2E_DEMO_STEPS_VERTICALS ||
  Object.keys(VERTICALS).filter((v) => VERTICALS[v].verified).join(',')
)
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

for (const v of RUN_VERTICALS) {
  if (!VERTICALS[v]) throw new Error(`demo-steps-outcomes: add ${v} to VERTICALS first`);
}

function chipExpectation(uc) {
  // CIBA rides the step-up path (useCases.js UC22: stepUpMethod 'ciba'), so
  // the wire answer for the step is step_up_required, not the eventual PERMIT.
  if (uc.stepUpMethod === 'ciba') return 'STEP_UP';
  // UC38 gates delegation on an MFA `acr` claim in agentInvokeRoute.js, BEFORE
  // the agent runs — an identity-layer check, not an Authorize obligation. The
  // E2E customer signs in with a password only, so the wire answer is always
  // step_up_required; the catalog's PERMIT describes an MFA-satisfied session.
  // (Declaring stepUpMethod on UC38 would NOT be the fix: the catalog field
  // also drives mcpToolAuthorizationService's forceStepUp, which would add a
  // SECOND step-up on the tool call after MFA had already been satisfied.)
  if (uc.id === 'UC38') return 'STEP_UP';
  return uc.expectedOutcome;
}

function assertChip(uc, body, vertical) {
  const reply = String(body.reply || body.message || '');
  const detail = `${uc.id} ${uc.title}: error=${body.error || ''} reply=${reply.slice(0, 200)}`;
  const exp = chipExpectation(uc);
  switch (exp) {
    case 'PERMIT':
    case 'DELEGATE_AND_EXECUTE':
      expect(body.success, detail).toBe(true);
      expect(reply, detail).not.toMatch(/❌/);
      if (exp === 'DELEGATE_AND_EXECUTE') expect(reply, detail).toMatch(/Delegation complete/i);
      break;
    case 'HITL_REQUIRED':
      expect(body.error, detail).toBe('hitl_required');
      break;
    case 'STEP_UP':
      expect(body.error, detail).toBe('step_up_required');
      break;
    case 'DENY':
      expect(body.success, detail).toBe(false);
      expect(body.error, detail).toMatch(/denied/);
      break;
    default:
      throw new Error(`${uc.id}: no chip assertion for expectedOutcome ${exp}`);
  }
  const re = VERTICALS[vertical].reply?.[uc.id];
  if (re) expect(reply, detail).toMatch(re);
}

/** Attack sims and the UC14b intent check share the sim result shape. */
function assertSim(uc, data) {
  const m = /^(PERMIT|DENY)(?:_(\d{3}))?$/.exec(uc.expectedOutcome || '');
  if (!m) throw new Error(`${uc.id}: no sim assertion for expectedOutcome ${uc.expectedOutcome}`);
  const detail = `${uc.id} ${uc.title}: status=${data.status} ${data.errorCode || ''} ${String(data.reason || '').slice(0, 200)}`;
  expect(attackSimVerdict(data), detail).toBe(m[1]);
  if (m[2]) expect(data.status, detail).toBe(Number(m[2]));
}

for (const vertical of RUN_VERTICALS) {
  for (const signedIn of [true, false]) {
    const tag = VERTICALS[vertical].verified ? '' : ' [UNVERIFIED — catalog-only]';
    test.describe(`Demo Steps outcomes — ${vertical} — ${signedIn ? 'signed in' : 'signed out'}${tag}`, () => {
      test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
      test.describe.configure({ timeout: 150_000 });

      let ctx;
      let catalog = [];
      let prevVertical = null;
      const restoreFlags = {};

      /** Same PATCH the SPA sends (ensureRequiredDemoFlags), remembering prior values. */
      async function armFlags(ids) {
        if (!ids.length) return;
        const flags = (await (await ctx.request.get('/api/admin/feature-flags')).json())?.flags || [];
        const updates = {};
        for (const id of ids) {
          const f = flags.find((x) => x.id === id);
          const on = !!f && (f.value === true || f.value === 'true');
          if (on) continue;
          updates[id] = true;
          if (!(id in restoreFlags)) restoreFlags[id] = f ? f.value : false;
        }
        if (!Object.keys(updates).length) return;
        const r = await ctx.request.patch('/api/admin/feature-flags', { data: { updates } });
        expect(r.ok(), `arm ${JSON.stringify(updates)}`).toBe(true);
      }

      test.beforeAll(async ({ browser }) => {
        ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        if (signedIn) {
          const page = await ctx.newPage();
          await loginAsCustomer(page);
          await page.close();
          const deadline = Date.now() + 30_000;
          let authed = false;
          while (!authed && Date.now() < deadline) {
            const s = await ctx.request.get('/api/auth/oauth/user/status').catch(() => null);
            authed = !!(s && s.ok() && (await s.json().catch(() => ({}))).authenticated);
            if (!authed) await new Promise((r) => setTimeout(r, 1_000));
          }
          expect(authed, 'customer session authenticated').toBe(true);
          prevVertical = (await (await ctx.request.get('/api/verticals/active')).json()).id;
          await activateVertical(ctx.request, vertical);
        }
        const r = await ctx.request.get(`/api/use-cases?vertical=${vertical}`);
        expect(r.ok(), `GET /api/use-cases?vertical=${vertical}`).toBe(true);
        catalog = (await r.json()).useCases || [];
      });

      test.afterAll(async () => {
        if (Object.keys(restoreFlags).length) {
          await ctx.request
            .patch('/api/admin/feature-flags', { data: { updates: restoreFlags } })
            .catch(() => {});
        }
        if (prevVertical) await activateVertical(ctx.request, prevVertical).catch(() => {});
        await ctx?.close().catch(() => {});
      });

      for (const id of DEMO_PRIMARY_USE_CASE_IDS) {
        test(id, async () => {
          const uc = catalog.find((u) => u.id === id);
          expect(uc, `${id} missing from the ${vertical} catalog`).toBeTruthy();
          test.skip(!signedIn && !runsSignedOut(uc), `${id} is ${uc.auth}-only; signed out the dropdown shows a sign-in prompt`);
          if (signedIn && !runsSignedOut(uc)) await armFlags(requiredFlagsForUseCase(uc));

          const t = uc.trigger || {};
          if (t.type === 'chip' && t.text) {
            const r = await ctx.request.post('/api/agent/invoke', {
              data: { prompt: t.text, vertical, useCaseId: uc.useCaseId, forceHeuristic: true },
              timeout: 120_000,
            });
            expect(r.status(), `${id} invoke HTTP`).toBe(200);
            assertChip(uc, await r.json(), vertical);
            return;
          }
          if (t.type === 'attack' && t.sim) {
            const sim = t.sim === 'wrong-aud-token' ? 'wrong-aud' : t.sim;
            const r = await ctx.request.post('/api/demo/attack-sim/run', { data: { sim }, timeout: 120_000 });
            expect(r.status(), `${id} attack-sim HTTP`).toBe(200);
            assertSim(uc, await r.json());
            return;
          }
          if (t.type === 'link' && id === 'UC14b') {
            const r = await ctx.request.post('/api/demo/intent-binding/run', {
              data: { action: 'permit', requestedAmount: 80 },
              timeout: 120_000,
            });
            expect(r.status(), `${id} intent-binding HTTP`).toBe(200);
            assertSim(uc, await r.json());
            return;
          }
          if (t.type === 'link' && t.path) {
            const heading = PAGE_HEADING[t.path];
            if (!heading) throw new Error(`${id}: add ${t.path} to PAGE_HEADING`);
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
            const resp = await page.goto(t.path, { waitUntil: 'domcontentloaded' });
            expect(resp.status(), `${id} GET ${t.path}`).toBe(200);
            // Scoped to <main>: the collapsed side nav carries the same label, hidden.
            await expect(page.locator('main').getByText(heading).first(), `${id} renders "${heading}"`).toBeVisible({ timeout: 30_000 });
            expect(errors, `${id} page errors`).toEqual([]);
            await page.close();
            return;
          }
          throw new Error(`${id}: no runnable trigger (${JSON.stringify(t)})`);
        });
      }
    });
  }
}
