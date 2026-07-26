// demo_api_ui/tests/e2e/capture-goldens.real.spec.js
'use strict';
/**
 * GOLDEN CAPTURE — record a known-good run for every (vertical, chip) catalog
 * pair into demo_api_server/data/goldens/<vertical>/<useCaseId>.json.
 *
 * Goldens are the Layer-3 demo fallback (REPLAY): captured from REAL runs on a
 * healthy stack, never hand-written, so they cannot drift into fiction. Re-run
 * this spec after catalog changes; scripts/check-goldens.js fails pre-push when
 * a golden disagrees with the current catalog.
 *
 * Run (healthy stack; source the MAIN checkout's .env — a worktree has none):
 *   set -a && . <repo>/demo_api_server/.env && set +a
 *   E2E_BASE_URL=https://api.ping.demo:4000 \
 *   E2E_CUSTOMER_USERNAME="$DEMO_USER_USERNAME" E2E_CUSTOMER_PASSWORD="$DEMO_USER_PASSWORD" \
 *   npx playwright test tests/e2e/capture-goldens.real.spec.js --config=playwright.real.config.js
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../../../demo_api_server/config/useCases.js');

const GOLDENS_ROOT = path.resolve(__dirname, '../../../demo_api_server/data/goldens');
const crypto = require('crypto');

/** Hash of the vertical's seed data — lets check-goldens detect VALUE drift
 * (catalog trigger unchanged, but the numbers a replay would show are stale).
 * Banking has no static seed (runtimeData mutates with every transfer), so its
 * goldens are age-tracked instead of hash-tracked. */
function seedHashFor(vertical) {
  const seed = path.resolve(__dirname, `../../../demo_api_server/config/verticals/${vertical}/seed.json`);
  if (!fs.existsSync(seed)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex').slice(0, 16);
}
const A2A_UNROUTABLE = /specialist/i;

function chipsFor(vertical) {
  const out = [];
  const seen = new Set();
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text) || seen.has(t.text)) continue;
    seen.add(t.text);
    out.push({ id: u.id, useCaseId: uc.useCaseId, text: t.text, expectedOutcome: uc.expectedOutcome || null });
  }
  return out;
}

test.describe('capture goldens from real runs', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  let ctx;
  let api;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await loginAsCustomer(await ctx.newPage());
    api = ctx.request;
  });
  test.afterAll(async () => {
    await activateVertical(api, 'banking').catch(() => {});
    await ctx?.close().catch(() => {});
  });

  for (const vertical of VERTICALS) {
    test(`capture ${vertical}`, async () => {
      await activateVertical(api, vertical);
      const dir = path.join(GOLDENS_ROOT, vertical);
      fs.mkdirSync(dir, { recursive: true });
      let captured = 0;
      for (const chip of chipsFor(vertical)) {
        if (!chip.useCaseId) continue;
        const r = await api.post('/api/agent/invoke', {
          data: { prompt: chip.text, forceHeuristic: true, vertical, useCaseId: chip.useCaseId },
          timeout: 60_000,
        });
        const body = await r.json().catch(() => ({}));
        // Only a HEALTHY result becomes a golden: a reply, no empty_reply flag.
        // HITL/consent challenges (428-class) are valid goldens too — the
        // expected outcome IS the challenge, so do NOT gate on r.ok() here.
        // An upstream failure still returns non-empty prose ("❌ Gateway
        // upstream error (HTTP 500)"), which passed this check and poisoned
        // every vertical's UC1 golden on 2026-07-17. Error replies carry a
        // leading ❌; genuine deny/HITL/step-up replies are plain prose.
        const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
        const ok = reply && !body.empty_reply && !reply.startsWith('❌');
        if (!ok) {
          console.log(`  SKIP ${vertical}/${chip.useCaseId}: unhealthy result (status ${r.status()}) — not captured`);
          continue;
        }
        const golden = {
          vertical,
          useCaseId: chip.useCaseId,
          ucId: chip.id,
          trigger: chip.text,
          expectedOutcome: chip.expectedOutcome,
          capturedAt: new Date().toISOString(),
          seedHash: seedHashFor(vertical),
          reply: body.reply,
          requiresConsent: body.requiresConsent === true || undefined,
          agentPath: body.agentPath || null,
          tokenEventCount: Array.isArray(body.tokenEvents) ? body.tokenEvents.length : 0,
        };
        fs.writeFileSync(path.join(dir, `${chip.useCaseId}.json`), JSON.stringify(golden, null, 2) + '\n');
        captured++;
        console.log(`  captured ${vertical}/${chip.useCaseId}`);
      }
      expect(captured).toBeGreaterThan(0);
    });
  }
});
