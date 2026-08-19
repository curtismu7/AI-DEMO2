#!/usr/bin/env node
// demo_api_server/scripts/useCaseSweep.js
'use strict';

/**
 * Use-case preflight sweep — "which use cases are not ready, and what is the
 * ONE reason behind most of them".
 *
 * WHY THIS EXISTS
 *
 * Every defect this repo hit recently was found by hand, one at a time: a flag
 * mirror that had drifted (22 use cases dead), a ledger of 202 green rows that
 * proved nothing, session keys nothing ever wrote, a feature flag whose OFF path
 * could not work. All of them were visible from static data. None of them were
 * being looked for.
 *
 * --dry-run answers the readiness question for every catalog entry in every
 * vertical with NO running stack, NO mutation and NO dispatch, then groups the
 * failures by cause so "43 rows red" reads as "one flag is off".
 *
 * Usage:
 *   node scripts/useCaseSweep.js --dry-run              all verticals
 *   node scripts/useCaseSweep.js --dry-run --vertical banking
 *   node scripts/useCaseSweep.js --dry-run --json       machine-readable
 *   node scripts/useCaseSweep.js --dry-run --strict     exit 1 on any blocked row
 *
 * Exit codes: 0 = swept (default, report only), 1 = --strict and rows blocked,
 * 2 = the sweep itself failed.
 */

const fs = require('fs');
const path = require('path');

const { listUseCases, VERTICALS, resolveUseCase } = require('../config/useCases');
const {
  checkChipPrerequisites,
  requiredFlagsForUseCase,
} = require('../services/demoStepPrerequisites');
const { CAUSE, dispatchClassification } = require('./useCaseSweepCauses');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY_RUN = has('--dry-run');
const AS_JSON = has('--json');
const STRICT = has('--strict');
const ONE_VERTICAL = valOf('--vertical', null);

if (!DRY_RUN) {
  console.error('useCaseSweep: only --dry-run is implemented.');
  console.error('It is deliberately read-only: no stack, no dispatch, no flag mutation.');
  process.exit(2);
}

/**
 * Feature-flag values as the RUNNING system would resolve them.
 *
 * Reads the real configStore. It is env-first, so this reflects what a cold
 * start would see. It does NOT see another process's in-memory overrides — a
 * value set at runtime through the admin API shows here only once persisted.
 * Stated plainly because the whole point of this sweep is to not overstate what
 * its evidence proves.
 */
function loadFlagView() {
  try {
    // Load the BFF's .env FIRST. configStore resolves env-first, but a standalone
    // process has none of it in process.env — so without this the sweep reported
    // env-pinned flags as OFF. ciba_enabled was the giveaway: the running BFF
    // resolves it true [PINNED by CIBA_ENABLED] while this script saw "false"
    // and invented a 9-row cluster. A preflight tool that manufactures failures
    // is worse than no preflight tool.
    try {
      // loadDemoEnv rather than raw dotenv: post-dotenvx-cutover a plain
      // config() returns `encrypted:...` ciphertext, which would make every
      // env-pinned flag read as its ciphertext string — the same class of
      // manufactured failure this block exists to prevent.
      require('./loadDemoEnv').loadDemoEnv();
    } catch (_) { /* dotenv absent or .env missing — reported via source below */ }
    const configStore = require('../services/configStore');
    return {
      getEffective: (k) => configStore.getEffective(k),
      source: fs.existsSync(path.join(__dirname, '..', '.env'))
        ? 'configStore + demo_api_server/.env (env-first, as a cold start would resolve)'
        : 'configStore only — demo_api_server/.env NOT found, env-pinned flags may read as off',
    };
  } catch (err) {
    return { getEffective: () => undefined, source: `unavailable (${err.message})` };
  }
}

/**
 * Heuristic action for a chip, resolved offline. Needed so client-dispatched
 * actions (mortgage_demo et al) are recognised — they route through the UI, not
 * the BFF, so scoring them via the API path is meaningless.
 * @returns {string|null}
 */
function heuristicAction(uc, vertical) {
  const t = uc.trigger || {};
  if (t.type !== 'chip' || !t.text) return null;
  try {
    const { parseHeuristic } = require('../services/nlIntentParser');
    const parsed = parseHeuristic(t.text, vertical, {});
    const action = parsed?.banking?.action || parsed?.action || null;
    return action && action !== 'none' ? action : null;
  } catch (_) {
    return null;
  }
}

/** One row per (vertical, use case). */
function sweepVertical(vertical, cfg) {
  const rows = [];
  for (const raw of listUseCases(vertical)) {
    const uc = resolveUseCase(raw.id, vertical) || raw;
    const trigger = uc.trigger || {};
    const requiredFlags = requiredFlagsForUseCase(uc);

    const cls = dispatchClassification(uc, heuristicAction(uc, vertical));

    let prereq = null;
    let flagsOff = [];
    try {
      prereq = checkChipPrerequisites(uc, vertical, cfg);
      flagsOff = requiredFlags.filter((f) => {
        const v = cfg.getEffective(f);
        return !(v === true || v === 'true' || v === 1 || v === '1');
      });
    } catch (err) {
      prereq = { ok: false, errors: [`prereq check threw: ${err.message}`] };
    }

    // A row is BLOCKED only when something would actually stop it running now.
    // "not scorable by the API path" is a property of the harness, not a defect,
    // and must not be counted as breakage.
    const blocked = !prereq.ok;
    rows.push({
      vertical,
      ucId: uc.id,
      useCaseId: uc.useCaseId,
      title: uc.title,
      triggerType: trigger.type || null,
      maturity: uc.maturity || null,
      primaryTool: uc.primaryTool || null,
      expectedOutcome: uc.expectedOutcome || null,
      requiredFlags,
      flagsOff,
      runnable: cls.scorable,
      notRunnableCause: cls.cause,
      notRunnableNote: cls.note,
      status: blocked ? 'BLOCKED' : 'READY',
      cause: blocked ? CAUSE.MISSING_PREREQ : null,
      causeDetail: blocked ? (flagsOff.length ? `flags_off:${flagsOff.sort().join('+')}` : 'other_prereq') : null,
      errors: prereq.errors || [],
    });
  }
  return rows;
}

/** Group blocked rows so a shared root cause reads as one line, not N. */
function cluster(rows) {
  const map = new Map();
  for (const r of rows.filter((x) => x.status === 'BLOCKED')) {
    const key = `${r.cause}|${r.causeDetail}`;
    if (!map.has(key)) {
      map.set(key, {
        cause: r.cause,
        causeDetail: r.causeDetail,
        count: 0,
        verticals: new Set(),
        ucIds: new Set(),
        sampleErrors: r.errors.slice(0, 2),
        suggestedFix: r.flagsOff.length
          ? `Arm ${r.flagsOff.join(' + ')} (PATCH /api/admin/feature-flags, or set it in the service env).`
          : 'See errors — A2A credentials or PAR config are the usual causes.',
      });
    }
    const c = map.get(key);
    c.count += 1;
    c.verticals.add(r.vertical);
    c.ucIds.add(r.ucId);
  }
  return [...map.values()]
    .map((c) => ({ ...c, verticals: [...c.verticals].sort(), ucIds: [...c.ucIds].sort() }))
    .sort((a, b) => b.count - a.count);
}

function main() {
  const cfg = loadFlagView();
  const verticals = ONE_VERTICAL ? [ONE_VERTICAL] : VERTICALS;
  if (ONE_VERTICAL && !VERTICALS.includes(ONE_VERTICAL)) {
    console.error(`useCaseSweep: unknown vertical "${ONE_VERTICAL}". Known: ${VERTICALS.join(', ')}`);
    process.exit(2);
  }

  const rows = verticals.flatMap((v) => sweepVertical(v, cfg));
  const clusters = cluster(rows);
  const blocked = rows.filter((r) => r.status === 'BLOCKED');
  const notScorable = rows.filter((r) => !r.runnable);

  const report = {
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    flagSource: cfg.source,
    verticals,
    totals: {
      rows: rows.length,
      ready: rows.length - blocked.length,
      blocked: blocked.length,
      notScorableByApiPath: notScorable.length,
    },
    clusters,
    rows,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const t = report.totals;
    console.log('');
    console.log('use-case preflight sweep — dry run (no stack, no dispatch, no mutation)');
    console.log(`  flags from : ${cfg.source}`);
    console.log(`  verticals  : ${verticals.length}`);
    console.log(`  rows       : ${t.rows}   READY ${t.ready}   BLOCKED ${t.blocked}`);
    console.log('');
    if (!clusters.length) {
      console.log('  No blocked use cases. Every declared prerequisite is satisfied.');
    } else {
      console.log(`  ${clusters.length} cluster(s), largest first — fix the top one to clear the most rows:`);
      for (const c of clusters) {
        console.log('');
        console.log(`  [${String(c.count).padStart(3)} rows]  ${c.cause} / ${c.causeDetail}`);
        console.log(`      verticals : ${c.verticals.join(', ')}`);
        console.log(`      use cases : ${c.ucIds.slice(0, 12).join(', ')}${c.ucIds.length > 12 ? ` … +${c.ucIds.length - 12}` : ''}`);
        console.log(`      fix       : ${c.suggestedFix}`);
      }
    }
    console.log('');
    // Reported separately and NEVER as failures: these are properties of how the
    // demo dispatches, not defects.
    const byCause = {};
    for (const r of notScorable) byCause[r.notRunnableCause] = (byCause[r.notRunnableCause] || 0) + 1;
    if (Object.keys(byCause).length) {
      console.log('  not scorable via the API path (informational, not failures):');
      for (const [k, n] of Object.entries(byCause).sort((a, b) => b[1] - a[1])) {
        console.log(`      ${String(n).padStart(3)}  ${k}`);
      }
      console.log('');
    }
  }

  if (STRICT && blocked.length) {
    console.error(`useCaseSweep: ${blocked.length} blocked use case(s) with --strict.`);
    process.exit(1);
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('useCaseSweep failed:', err && err.stack ? err.stack : err);
  process.exit(2);
}
