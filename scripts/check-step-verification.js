#!/usr/bin/env node
'use strict';
/**
 * check-step-verification.js — drift/staleness gate for the step-verification
 * ledger (demo_api_server/data/step-verification/<vertical>/<useCaseId>.<triggerType>.<mode>.json).
 *
 * Rules (mirrors check-goldens.js):
 *   - ORPHAN (fail): a ledger entry's useCaseId no longer exists in the catalog.
 *   - MALFORMED (fail): missing required fields, or a status outside the vocabulary.
 *   - FAIL STATUS (fail): any entry with status "FAIL" — the report must not be
 *     green when a check recorded failure (unit-parse PASS must not hide this).
 *   - UNPROVEN (counted, not a failure): the check ran with the runtime conditions
 *     stubbed. Absence of proof is not a defect, so it does not fail the gate —
 *     but it is printed on every run so it cannot pass for coverage.
 *   - STALE (warn only): checkedAt older than MAX_AGE_DAYS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_ROOT = path.join(ROOT, 'demo_api_server', 'data', 'step-verification');
const REQUIRED = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];
const { STATUSES } = require(path.join(
  __dirname, '..', 'demo_api_server', 'services', 'stepVerificationLedger.js',
));
const MAX_AGE_DAYS = Number(process.env.STEP_VERIFICATION_MAX_AGE_DAYS || 30);

// A few ledger entries legitimately reference ids outside the main USE_CASES
// catalog: pingone-admin's ADMIN1-4 (config/admin/demoSteps.js — deliberately
// not part of the 22-use-case banking trust-ladder catalog, see that file's
// header comment) and a handful of unit-ref slugs stepVerification.adminAndRefs.test.js
// coined for retail agent-lifecycle/kill-switch coverage that predates any
// catalog entry (#761). Without these, check-step-verification.js flags them
// as orphans every time those suites regenerate the files.
const NON_CATALOG_VALID_IDS = new Set([
  'agent-lifecycle-list-orders',
  'agent-lifecycle-revoke',
  'ciba-out-of-band-approval',
]);

function catalogUseCaseIds() {
  const { USE_CASES } = require(path.join(ROOT, 'demo_api_server', 'config', 'useCases.js'));
  const { ADMIN_DEMO_STEPS } = require(path.join(ROOT, 'demo_api_server', 'config', 'admin', 'demoSteps.js'));
  return new Set([
    ...USE_CASES.map((u) => u.id),
    ...ADMIN_DEMO_STEPS.map((s) => s.id),
    ...NON_CATALOG_VALID_IDS,
  ]);
}

function checkStepVerification() {
  const failures = [];
  const warnings = [];
  let oldestDays = 0;
  const ids = catalogUseCaseIds();
  let total = 0;
  let proven = 0;
  let unproven = 0;

  if (fs.existsSync(LEDGER_ROOT)) {
    for (const vertical of fs.readdirSync(LEDGER_ROOT)) {
      const dir = path.join(LEDGER_ROOT, vertical);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        total++;
        const key = `${vertical}/${f}`;
        let entry;
        try {
          entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch (e) {
          failures.push(`[malformed] ${key}: ${e.message}`);
          continue;
        }
        for (const field of REQUIRED) {
          if (entry[field] == null || entry[field] === '') failures.push(`[malformed] ${key}: missing "${field}"`);
        }
        if (entry.useCaseId && !ids.has(entry.useCaseId)) {
          failures.push(`[orphan] ${key}: useCaseId "${entry.useCaseId}" no longer in useCases.js — delete or fix`);
        }
        if (entry.status && !STATUSES.includes(entry.status)) {
          failures.push(
            `[malformed] ${key}: unknown status "${entry.status}" — expected one of ${STATUSES.join(', ')}`,
          );
        }
        if (entry.status === 'PASS') proven++;
        if (entry.status === 'UNPROVEN') unproven++;
        if (entry.status === 'FAIL') {
          failures.push(
            `[fail] ${key}: status FAIL`
            + (entry.errorClass ? ` errorClass=${entry.errorClass}` : '')
            + ' — re-run the failing suite or fix the demo before claiming green',
          );
        }
        const days = (Date.now() - Date.parse(entry.checkedAt)) / 86400000;
        if (Number.isFinite(days)) {
          oldestDays = Math.max(oldestDays, Math.floor(days));
          if (days > MAX_AGE_DAYS) {
            warnings.push(`[age] ${key}: checked ${Math.floor(days)}d ago (> ${MAX_AGE_DAYS}d) — re-run before the next demo`);
          }
        }
      }
    }
  }

  return { failures, warnings, oldestDays, total, proven, unproven };
}

if (require.main === module) {
  const { failures, warnings, oldestDays, total, proven, unproven } = checkStepVerification();
  console.log(
    `[check-step-verification] ${total} ledger entries`
    + ` — ${proven} proven, ${unproven} unproven (declaration-only)`
    + (total ? `; oldest check ${oldestDays}d ago` : ''),
  );
  for (const w of warnings) console.warn('  ' + w);
  if (failures.length) {
    console.error('[check-step-verification] FAILED:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[check-step-verification] OK — no orphaned, malformed, or FAIL ledger entries.');
}

module.exports = { checkStepVerification, LEDGER_ROOT };
