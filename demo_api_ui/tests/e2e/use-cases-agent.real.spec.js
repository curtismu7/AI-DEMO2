// demo_api_ui/tests/e2e/use-cases-agent.real.spec.js
'use strict';
/**
 * Use-case → agent audit (real stack, API-level).
 *
 * Exercises the EXACT path the Use Cases page uses: sendAgentMessage() →
 * POST /api/agent/invoke { prompt, vertical, useCaseId }. For every vertical
 * and every use case with a chip trigger (resolved per-vertical via
 * GET /api/use-cases?vertical=<v>), the agent must return a VALID response:
 *
 *   - HTTP 200
 *   - a non-empty reply
 *   - NOT the heuristics no-match capability catalog ("Heuristics-only mode —
 *     no LLM…") — that reply means the agent did not understand its own
 *     use-case trigger phrase, the exact bug this suite exists to catch.
 *
 * DENY / STEP_UP / HITL outcomes are still VALID responses (the reply
 * describes the policy outcome); only the catalog card and transport errors
 * are failures.
 *
 * Flags pinned for the run (restored in afterAll):
 *   - ff_authorize_real=false (no PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID
 *     on this deployment; simulated engine is the designed fallback)
 *   - ff_a2a_delegation=true       (UC2.5 delegate-to-specialist is flag-gated)
 *
 * UC2.5 is skipped in verticals with no configured A2A specialist
 * (config/a2aSpecialists.js) — unavailable there by design.
 *
 * Results table: evidence/<date>/use-cases-results.json
 *
 * Run: stack up + E2E_CUSTOMER_* env (auto-skips otherwise):
 *   npx playwright test tests/e2e/use-cases-agent.real.spec.js \
 *     --config=playwright.real.config.js --reporter=list
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');

const ALL_VERTICALS = [
  'banking', 'healthcare', 'retail', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing',
];
// E2E_UC_VERTICALS=government,university → audit a subset (e.g. resume a run).
const VERTICALS = (process.env.E2E_UC_VERTICALS || ALL_VERTICALS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Keep in sync with demo_api_server/config/a2aSpecialists.js.
const A2A_SUPPORTED = new Set(['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce', 'government', 'university', 'manufacturing']);

const EVIDENCE_ROOT =
  process.env.E2E_EVIDENCE_DIR ||
  path.resolve(__dirname, '../../evidence', new Date().toISOString().slice(0, 10));

const CATALOG_RE = /heuristics-only mode/i;

test.describe('use-case → agent audit (real)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  let ctx;
  const restoreFlags = {};
  const results = [];

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAsCustomer(page);
    await page.close();

    const PIN_FLAGS = { ff_authorize_real: false, ff_a2a_delegation: true };
    const flagsResp = await ctx.request.get('/api/admin/feature-flags');
    if (flagsResp.ok()) {
      const flags = (await flagsResp.json())?.flags || [];
      const updates = {};
      for (const [id, want] of Object.entries(PIN_FLAGS)) {
        const f = flags.find((x) => x.id === id);
        const current = f && (f.value === true || f.value === 'true');
        if (f && current !== want) {
          updates[id] = want;
          restoreFlags[id] = current;
        }
      }
      if (Object.keys(updates).length) {
        const patch = await ctx.request.patch('/api/admin/feature-flags', { data: { updates } });
        expect(patch.ok(), `flags pinned: ${JSON.stringify(updates)}`).toBe(true);
      }
    }
  });

  test.afterAll(async () => {
    if (Object.keys(restoreFlags).length) {
      await ctx.request
        .patch('/api/admin/feature-flags', { data: { updates: restoreFlags } })
        .catch(() => {});
    }
    // Leave the demo on its default vertical.
    await activateVertical(ctx.request, 'banking').catch(() => {});
    if (results.length) {
      fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
      const file = path.join(EVIDENCE_ROOT, 'use-cases-results.json');
      // Merge with prior runs (subset re-runs via E2E_UC_VERTICALS) keyed by
      // vertical+id so a resume overwrites its own rows, not the whole table.
      let merged = [];
      try {
        merged = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (_) { /* first run */ }
      const key = (r) => `${r.vertical}|${r.id}`;
      const mine = new Set(results.map(key));
      merged = merged.filter((r) => !mine.has(key(r))).concat(results);
      fs.writeFileSync(file, JSON.stringify(merged, null, 2));
      console.log(`use-case audit: ${results.length} rows merged (${merged.length} total) → ${file}`);
    }
    await ctx?.close().catch(() => {});
  });

  for (const vertical of VERTICALS) {
    test(`${vertical}: every chip-triggered use case gets a valid agent response`, async () => {
      await activateVertical(ctx.request, vertical);

      const listResp = await ctx.request.get(`/api/use-cases?vertical=${vertical}`);
      expect(listResp.status(), `${vertical}: use-case catalog fetch`).toBe(200);
      const { useCases } = await listResp.json();
      expect(Array.isArray(useCases) && useCases.length > 0, `${vertical}: catalog non-empty`).toBe(true);

      const failures = [];
      for (const uc of useCases) {
        const trig = uc.trigger;
        if (!trig || trig.type !== 'chip' || !trig.text) continue;
        if (uc.id === 'UC2.5' && !A2A_SUPPORTED.has(vertical)) {
          results.push({ vertical, id: uc.id, useCaseId: uc.useCaseId, trigger: trig.text, outcome: 'SKIPPED (no A2A specialist for vertical — by design)' });
          continue;
        }

        let resp = await ctx.request.post('/api/agent/invoke', {
          data: { prompt: trig.text, vertical, useCaseId: uc.useCaseId },
          timeout: 120_000,
        });
        // The dev BFF runs under `node --watch` and can restart mid-run
        // (~30s outage → 502 from the UI proxy). That is infra flake, not an
        // agent answer: wait for health and retry once before judging.
        if (resp.status() >= 502 && resp.status() <= 504) {
          console.log(`${vertical}/${uc.id}: got ${resp.status()} — waiting for BFF health and retrying once`);
          const deadline = Date.now() + 90_000;
          while (Date.now() < deadline) {
            const h = await ctx.request.get('/api/health', { timeout: 5_000 }).catch(() => null);
            if (h && h.ok()) break;
            await new Promise((r) => setTimeout(r, 3_000));
          }
          resp = await ctx.request.post('/api/agent/invoke', {
            data: { prompt: trig.text, vertical, useCaseId: uc.useCaseId },
            timeout: 120_000,
          });
        }
        let status = resp.status();
        let body = await resp.json().catch(() => ({}));
        let reply = String(body.reply || '');
        // Single retry when the reply is the catalog card: transient LLM /
        // use-case-simulation hiccups fall back to it (observed ~1/128). A
        // persistent routing bug still fails — it returns the catalog twice.
        if (status === 200 && CATALOG_RE.test(reply)) {
          console.log(`${vertical}/${uc.id}: catalog reply — retrying once after 5s`);
          await new Promise((r) => setTimeout(r, 5_000));
          resp = await ctx.request.post('/api/agent/invoke', {
            data: { prompt: trig.text, vertical, useCaseId: uc.useCaseId },
            timeout: 120_000,
          });
          status = resp.status();
          body = await resp.json().catch(() => ({}));
          reply = String(body.reply || '');
        }
        const row = {
          vertical,
          id: uc.id,
          useCaseId: uc.useCaseId,
          trigger: trig.text,
          status,
          toolsCalled: body.toolsCalled || [],
          requiresConsent: !!body.requiresConsent,
          replySnippet: reply.slice(0, 160),
        };

        let problem = null;
        if (status !== 200) problem = `HTTP ${status}`;
        else if (!reply.trim()) problem = 'empty reply';
        else if (CATALOG_RE.test(reply)) problem = 'catalog no-match card (agent did not understand its own use-case trigger)';
        row.outcome = problem ? `FAIL: ${problem}` : 'OK';
        results.push(row);
        if (problem) failures.push(`${uc.id} "${trig.text}" → ${problem} | reply: ${reply.slice(0, 120)}`);
        console.log(`${vertical}/${uc.id} "${trig.text}" → ${row.outcome}${row.toolsCalled.length ? ' tools=' + row.toolsCalled.join(',') : ''}${row.requiresConsent ? ' [consent]' : ''}`);
      }

      expect(
        failures.length,
        `${vertical}: use cases with invalid agent responses:\n  ${failures.join('\n  ')}`,
      ).toBe(0);
    });
  }
});
