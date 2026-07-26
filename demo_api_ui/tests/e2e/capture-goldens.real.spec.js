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
const { requiredFlagsForUseCase } = require('../../../demo_api_server/services/demoStepPrerequisites.js');
const { LLM_ANALYSIS_UNROUTABLE } = require('../../../demo_api_server/scripts/useCaseSweepCauses.js');

const GOLDENS_ROOT = path.resolve(__dirname, '../../../demo_api_server/data/goldens');
// Sibling of goldens/, never inside it — check-goldens.js treats every entry in
// that directory as a vertical and readdirSync()s it, so a file there throws.
const REPORT_PATH = path.resolve(__dirname, '../../../demo_api_server/data/goldens-capture-report.json');
const crypto = require('crypto');

// Why a chip was not captured. Absence of a golden used to be silent — the loop
// logged a SKIP line to stdout and moved on, so "56 of 100 missing" carried no
// reason and nobody could tell a broken chip from one that is uncapturable by
// construction. Every skip now records one of these.
const SKIP = {
  UNROUTABLE: 'llm_analysis_unroutable',   // primaryTool null by design (UC34/35)
  UNHEALTHY: 'unhealthy_result',           // dispatched, reply was empty or an error
  AGENT_FAILED: 'agent_could_not_complete', // 200 + prose, but the agent gave up
};

// An agent that fails politely still returns HTTP 200 and non-empty prose with
// no leading ❌, so the existing health check accepts it. UC34 in LLM mode
// returns "I'm sorry, but I'm currently unable to retrieve your transaction
// history" — recording that as a golden would make REPLAY perform the failure
// on demand, which is worse than having no golden at all.
//
// Deliberately narrow: these match an agent that could not EXECUTE. A policy
// DENY ("that transfer requires approval") is a legitimate golden — the denial
// is the demo — so nothing here may match a refusal-by-policy.
const AGENT_FAILURE_PROSE = [
  /unable to retrieve/i,
  /could ?n[o']t complete that request/i,
  /please try rephrasing/i,
  /needs an LLM mode/i,
];

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
  const skips = [];          // {vertical, useCaseId, ucId, reason, detail}
  let restoreFlags = null;   // {flagId: priorValue} — only flags WE changed

  /** Union of the flags every chip in the catalog declares it needs. */
  function requiredFlagUnion() {
    const out = new Set();
    for (const vertical of VERTICALS) {
      for (const chip of chipsFor(vertical)) {
        const uc = resolveUseCase(chip.id, vertical);
        for (const f of requiredFlagsForUseCase(uc) || []) out.add(f);
      }
    }
    return [...out];
  }

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await loginAsCustomer(await ctx.newPage());
    api = ctx.request;

    // Arm the flags the chips declare they need. Without this, every flag-gated
    // chip returns an error, gets skipped, and its golden silently never exists
    // — 17 of the 56 missing goldens were exactly this. Declarative only: we arm
    // what requiredFlagsForUseCase already says a chip needs, never a flag
    // guessed from a failure.
    const flagsRes = await api.get('/api/admin/feature-flags');
    const before = new Map(
      ((await flagsRes.json().catch(() => ({}))).flags || []).map((f) => [f.id, f]),
    );
    const updates = {};
    const prior = {};
    for (const id of requiredFlagUnion()) {
      const f = before.get(id);
      if (!f || f.value === true) continue;
      // Env-pinned flags ignore PATCH (getEffective is env-FIRST), so asking is
      // pointless and restoring one would be a lie about what we changed.
      if (f.pinned) {
        console.log(`  flag ${id} is pinned by ${f.pinnedBy} — cannot arm, chips needing it will skip`);
        continue;
      }
      updates[id] = true;
      prior[id] = f.value;
    }
    if (Object.keys(updates).length) {
      const r = await api.patch('/api/admin/feature-flags', { data: { updates } });
      if (r.ok()) {
        restoreFlags = prior;
        console.log(`  armed ${Object.keys(updates).join(', ')}`);
      } else {
        console.log(`  WARNING: could not arm flags (HTTP ${r.status()}) — flag-gated chips will skip`);
      }
    }
  });

  test.afterAll(async () => {
    // Restore before anything else: a stuck flag mislabels every later run.
    if (restoreFlags && Object.keys(restoreFlags).length) {
      await api.patch('/api/admin/feature-flags', { data: { updates: restoreFlags } }).catch(() => {});
      console.log(`  restored ${Object.keys(restoreFlags).join(', ')}`);
    }
    await activateVertical(api, 'banking').catch(() => {});

    // The point of the report: absence of a golden always carries a reason.
    const byReason = {};
    for (const s of skips) {
      if (!byReason[s.reason]) byReason[s.reason] = [];
      byReason[s.reason].push(`${s.vertical}/${s.useCaseId}`);
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      capturedAt: new Date().toISOString(),
      skipped: skips.length,
      byReason: Object.fromEntries(
        Object.entries(byReason).map(([k, v]) => [k, { count: v.length, pairs: v.sort() }]),
      ),
      skips,
    }, null, 2) + '\n');
    console.log(`  skip report -> ${path.relative(process.cwd(), REPORT_PATH)} (${skips.length} skipped)`);

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
        // UC34/UC35 have primaryTool null: they are LLM-REASONING steps with no
        // tool to name, not chips whose tool we failed to record. Forcing the
        // heuristic on them guarantees a refusal ("this analysis needs an LLM
        // mode"), which is why all 18 rows have always been missing. Let them
        // reach the LLM instead. Slower (~35s each) and the reply is a sample
        // rather than a contract, but a real recorded answer beats no fallback.
        const llmReasoning = LLM_ANALYSIS_UNROUTABLE.has(chip.id);
        const r = await api.post('/api/agent/invoke', {
          data: {
            prompt: chip.text,
            ...(llmReasoning ? {} : { forceHeuristic: true }),
            vertical,
            useCaseId: chip.useCaseId,
          },
          timeout: llmReasoning ? 120_000 : 60_000,
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
          skips.push({ vertical, useCaseId: chip.useCaseId, ucId: chip.id, reason: SKIP.UNHEALTHY,
            detail: `HTTP ${r.status()}: ${(reply || '(empty reply)').slice(0, 160)}` });
          console.log(`  SKIP ${vertical}/${chip.useCaseId}: unhealthy result (status ${r.status()}) — not captured`);
          continue;
        }
        // 200 + prose, but the agent gave up. Never record this: REPLAY would
        // reproduce the failure on demand.
        if (AGENT_FAILURE_PROSE.some((re) => re.test(reply))) {
          skips.push({ vertical, useCaseId: chip.useCaseId, ucId: chip.id, reason: SKIP.AGENT_FAILED,
            detail: reply.slice(0, 160) });
          console.log(`  SKIP ${vertical}/${chip.useCaseId}: agent could not complete — not captured`);
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
