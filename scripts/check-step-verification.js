#!/usr/bin/env node
'use strict';
/**
 * check-step-verification.js — drift/staleness gate for the step-verification
 * ledger (demo_api_server/data/step-verification/<vertical>/<useCaseId>.<triggerType>.<mode>.json).
 *
 * Rules (mirrors check-goldens.js):
 *   - ORPHAN (fail): a ledger entry's useCaseId no longer exists in the catalog.
 *   - MALFORMED (fail): missing required fields.
 *   - FAIL STATUS (fail): any entry with status "FAIL" — the report must not be
 *     green when a check recorded failure (unit-parse PASS must not hide this).
 *   - STALE (warn only): checkedAt older than MAX_AGE_DAYS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_ROOT = path.join(ROOT, 'demo_api_server', 'data', 'step-verification');
const REQUIRED = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];
const MAX_AGE_DAYS = Number(process.env.STEP_VERIFICATION_MAX_AGE_DAYS || 30);

function catalogUseCaseIds() {
  const { USE_CASES } = require(path.join(ROOT, 'demo_api_server', 'config', 'useCases.js'));
  const { ADMIN_DEMO_STEPS } = require(path.join(ROOT, 'demo_api_server', 'config', 'admin', 'demoSteps.js'));
  const ids = new Set(USE_CASES.map((u) => u.id));
  for (const step of ADMIN_DEMO_STEPS) ids.add(step.id);
  return ids;
}

function checkStepVerification() {
  const failures = [];
  const warnings = [];
  let oldestDays = 0;
  const ids = catalogUseCaseIds();
  let total = 0;

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

  return { failures, warnings, oldestDays, total };
}

if (require.main === module) {
  const { failures, warnings, oldestDays, total } = checkStepVerification();
  console.log(`[check-step-verification] ${total} ledger entries` + (total ? `; oldest check ${oldestDays}d ago` : ''));
  for (const w of warnings) console.warn('  ' + w);
  if (failures.length) {
    console.error('[check-step-verification] FAILED:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[check-step-verification] OK — no orphaned, malformed, or FAIL ledger entries.');
}

module.exports = { checkStepVerification, LEDGER_ROOT };
