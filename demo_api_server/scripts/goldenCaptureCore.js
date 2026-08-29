'use strict';
/**
 * goldenCaptureCore.js — the ONE implementation of golden capture.
 *
 * Goldens are the Layer-3 demo fallback (REPLAY): a recorded known-good reply
 * per (vertical, chip), captured from real runs so they cannot drift into
 * fiction. See scripts/check-goldens.js for the drift gate.
 *
 * Why this is a library and not just the Playwright spec: the spec needs a
 * browser only to LOG IN — every capture call after that is plain HTTP. On this
 * machine Playwright's browser downloads extract incompletely (chromium-1217 is
 * missing its Framework dylib; chromium_headless_shell-1217 hangs mid-extract
 * leaving only ABOUT and LICENSE), so capture was unrunnable for a reason that
 * has nothing to do with the demo. Putting the logic here lets a plain Node
 * entry point (captureGoldens.js) drive it with a headless BFF session, while
 * the spec delegates to the same code.
 *
 * Callers inject `http` so neither transport is privileged:
 *   http.get(path)                    -> { status, json() }
 *   http.post(path, body, timeoutMs)  -> { status, json() }
 *   http.patch(path, body)            -> { status, json() }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases');
const { requiredFlagsForUseCase } = require('../services/demoStepPrerequisites');
const { LLM_ANALYSIS_UNROUTABLE } = require('./useCaseSweepCauses');
// The ONE failure-prose list, shared with scripts/check-goldens.js. This file
// used to keep a private 4-pattern copy while the shared list grew to 9, so the
// capture path silently accepted everything the gate would later reject — see
// the comment on the deleted copy below.
const { failurePatternFor } = require('../../scripts/golden-failure-prose');

const ROOT = path.resolve(__dirname, '..', '..');
const GOLDENS_ROOT = path.join(ROOT, 'demo_api_server', 'data', 'goldens');
// Sibling of goldens/, never inside it: check-goldens.js treats every entry in
// that directory as a vertical and readdirSync()s it, so a file there throws.
const REPORT_PATH = path.join(ROOT, 'demo_api_server', 'data', 'goldens-capture-report.json');

/** Why a chip was not captured. Absence of a golden must always carry a reason. */
const SKIP = {
  UNHEALTHY: 'unhealthy_result',
  AGENT_FAILED: 'agent_could_not_complete',
};

/**
 * An agent that fails politely still returns 200 with non-empty prose and no
 * leading ❌, so the health check accepts it. Recording that makes REPLAY
 * perform the failure on cue — worse than having no golden at all.
 *
 * Narrow on purpose: these match an agent that could not EXECUTE. A policy DENY
 * ("that transfer requires approval") is a legitimate golden — the denial IS the
 * demo — so nothing here may match a refusal-by-policy.
 */
// AGENT_FAILURE_PROSE used to be redefined here with four patterns while
// scripts/golden-failure-prose.js — whose docstring says the list lives there
// "because BOTH sides need it" — had grown to nine. The capture path therefore
// accepted five classes of failure the gate rejects, including every one that
// actually shipped: "could not complete this request", the model's flat refusal
// ("I'm sorry, but I can't help with that", 7 goldens across 6 verticals,
// 2026-07-27..2026-08-28) and "insufficient_scope" (4 banking goldens,
// 2026-08-28). Import it instead; a second copy is the bug.

const A2A_UNROUTABLE = /specialist/i;

/** Hash of the vertical's seed data so check-goldens can detect VALUE drift. */
function seedHashFor(vertical) {
  const seed = path.join(ROOT, 'demo_api_server', 'config', 'verticals', vertical, 'seed.json');
  if (!fs.existsSync(seed)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex').slice(0, 16);
}

/** Distinct chip triggers for a vertical, resolved for that vertical. */
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

/** Union of the flags every catalog chip declares it needs. */
function requiredFlagUnion(verticals) {
  const out = new Set();
  for (const vertical of verticals) {
    for (const chip of chipsFor(vertical)) {
      const uc = resolveUseCase(chip.id, vertical);
      for (const f of requiredFlagsForUseCase(uc) || []) out.add(f);
    }
  }
  return [...out];
}

/**
 * Arm the flags the chips declare they need. Declarative only — never a flag
 * inferred from a failure. Returns the prior values of ONLY what we changed.
 */
async function armFlags(http, verticals, log) {
  const res = await http.get('/api/admin/feature-flags');
  const before = new Map(((await res.json().catch(() => ({}))).flags || []).map((f) => [f.id, f]));
  const updates = {};
  const prior = {};
  for (const id of requiredFlagUnion(verticals)) {
    const f = before.get(id);
    if (!f || f.value === true) continue;
    // Env-pinned flags ignore PATCH (getEffective is env-FIRST), so asking is
    // pointless and "restoring" one would misreport what we touched.
    if (f.pinned) {
      log(`  flag ${id} is pinned by ${f.pinnedBy} — cannot arm; chips needing it will skip`);
      continue;
    }
    updates[id] = true;
    prior[id] = f.value;
  }
  if (!Object.keys(updates).length) return null;
  const r = await http.patch('/api/admin/feature-flags', { updates });
  if (r.status !== 200) {
    log(`  WARNING: could not arm flags (HTTP ${r.status}) — flag-gated chips will skip`);
    return null;
  }
  log(`  armed ${Object.keys(updates).join(', ')}`);
  return prior;
}

/**
 * Capture goldens for the given verticals.
 *
 * @param {object} opts
 * @param {{get:Function,post:Function,patch:Function}} opts.http
 * @param {string[]} [opts.verticals]
 * @param {Function} [opts.log]
 * @returns {Promise<{captured:number, skips:Array, perVertical:object}>}
 */
/**
 * @param {object} o
 * @param {boolean} [o.dryRun] exercise every chip and report, writing NOTHING.
 *   captureGoldens.js advertised --dry-run in its usage string while parsing it
 *   nowhere, so a "dry run" silently overwrote real goldens — including, on
 *   2026-08-28, poisoned ones. A flag that is documented but inert is worse than
 *   no flag: it is trusted precisely when someone is being careful.
 */
async function runGoldenCapture({ http, verticals = VERTICALS, log = console.log, dryRun = false }) {
  const skips = [];
  const perVertical = {};
  let captured = 0;
  let restoreFlags = null;

  try {
    restoreFlags = await armFlags(http, verticals, log);

    for (const vertical of verticals) {
      const act = await http.post('/api/verticals/active', { id: vertical });
      if (act.status !== 204) {
        log(`  SKIP vertical ${vertical}: activate returned HTTP ${act.status}`);
        continue;
      }
      const dir = path.join(GOLDENS_ROOT, vertical);
      fs.mkdirSync(dir, { recursive: true });
      perVertical[vertical] = 0;

      for (const chip of chipsFor(vertical)) {
        if (!chip.useCaseId) continue;
        // UC34/UC35 have primaryTool null: LLM-REASONING steps with no tool to
        // name. Forcing the heuristic guarantees a "needs an LLM mode" refusal,
        // which is why all 18 rows were always missing. Let them reach the LLM.
        const llmReasoning = LLM_ANALYSIS_UNROUTABLE.has(chip.id);
        const r = await http.post(
          '/api/agent/invoke',
          {
            prompt: chip.text,
            ...(llmReasoning ? {} : { forceHeuristic: true }),
            vertical,
            useCaseId: chip.useCaseId,
          },
          llmReasoning ? 180000 : 60000,
        );
        const body = await r.json().catch(() => ({}));
        // HITL/consent challenges (428-class) are valid goldens — the expected
        // outcome IS the challenge — so do NOT gate on r.status here. An upstream
        // failure still returns non-empty prose ("❌ Gateway upstream error"),
        // which poisoned every vertical's UC1 golden on 2026-07-17. Error replies
        // carry a leading ❌; genuine deny/step-up replies are plain prose.
        const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
        // The ❌ gate exists because an upstream 500 ("❌ Gateway upstream error")
        // once passed as healthy and poisoned every vertical's UC1 golden. But it
        // assumed genuine denials arrive as plain prose, and gateway denials do
        // not: UC31 returns "❌ Agent Gateway: weather scope restricted to Texas
        // (demo policy)". That is the outcome UC31 EXISTS to demonstrate, so
        // rejecting it means the deny use cases can never have a fallback.
        //
        // Discriminate on the catalog's authored expectedOutcome, not on the
        // prose: for a DENY-family chip a ❌ reply is the expected result; for a
        // PERMIT chip it still means something broke.
        const denyExpected = /DENY|STEP_UP|HITL/i.test(String(chip.expectedOutcome || ''));
        const errorish = reply.startsWith('❌');
        if (!reply || body.empty_reply || (errorish && !denyExpected)) {
          skips.push({ vertical, useCaseId: chip.useCaseId, ucId: chip.id, reason: SKIP.UNHEALTHY,
            detail: `HTTP ${r.status}: ${(reply || '(empty reply)').slice(0, 160)}` });
          log(`  SKIP ${vertical}/${chip.useCaseId}: unhealthy (HTTP ${r.status})`);
          continue;
        }
        // failurePatternFor(), not a bare regex test: it checks only the LEADING
        // window, because a genuine failure IS the whole reply while a healthy
        // UC35 answer legitimately DISCUSSES one — its 2296-char explanation
        // says "could not complete this request" at offset 1595. Testing the
        // full text would reject that correct golden.
        if (failurePatternFor(reply)) {
          skips.push({ vertical, useCaseId: chip.useCaseId, ucId: chip.id, reason: SKIP.AGENT_FAILED,
            detail: reply.slice(0, 160) });
          log(`  SKIP ${vertical}/${chip.useCaseId}: agent could not complete`);
          continue;
        }
        if (dryRun) {
          captured += 1;
          log(`  WOULD capture ${vertical}/${chip.useCaseId} (dry run — nothing written)`);
          continue;
        }
        fs.writeFileSync(path.join(dir, `${chip.useCaseId}.json`), `${JSON.stringify({
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
        }, null, 2)}\n`);
        captured += 1;
        perVertical[vertical] += 1;
        log(`  captured ${vertical}/${chip.useCaseId}`);
      }
    }
  } finally {
    // Restore FIRST: a stuck flag mislabels every later run.
    if (restoreFlags && Object.keys(restoreFlags).length) {
      await http.patch('/api/admin/feature-flags', { updates: restoreFlags }).catch(() => {});
      log(`  restored ${Object.keys(restoreFlags).join(', ')}`);
    }
    await http.post('/api/verticals/active', { id: 'banking' }).catch(() => {});

    const byReason = {};
    for (const s of skips) {
      if (!byReason[s.reason]) byReason[s.reason] = [];
      byReason[s.reason].push(`${s.vertical}/${s.useCaseId}`);
    }
    if (dryRun) {
      log(`  dry run — skip report NOT written to ${path.relative(process.cwd(), REPORT_PATH)}`);
    } else fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      captured,
      skipped: skips.length,
      byReason: Object.fromEntries(
        Object.entries(byReason).map(([k, v]) => [k, { count: v.length, pairs: v.sort() }]),
      ),
      skips,
    }, null, 2)}\n`);
    log(`  report -> ${path.relative(ROOT, REPORT_PATH)} (${captured} captured, ${skips.length} skipped)`);
  }

  return { captured, skips, perVertical };
}

module.exports = {
  runGoldenCapture,
  chipsFor,
  seedHashFor,
  requiredFlagUnion,
  SKIP,
  GOLDENS_ROOT,
  REPORT_PATH,
};
