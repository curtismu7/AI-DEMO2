// demo_api_server/services/stepVerificationLedger.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'data', 'step-verification');

/**
 * @typedef {Object} LedgerEntry
 * @property {string} vertical
 * @property {string} useCaseId
 * @property {'chip'|'prompt'|'button'|'attack'|'link'} triggerType
 * @property {'heuristic'|'llamacpp'|'helix'|'unit-parse'|'unit-gate'|'unit-prereq'|'unit-ref'} mode
 * @property {'PASS'|'FAIL'} status
 * @property {string|null} errorClass one of 'server_error'|'parse_error'|'llm_error'|'wrong_response'|'wrong_gate'|'missing_prereq'|'exchange_failed'|'empty_token_events'|'failure_without_detail'|'no_event_detail'|null
 * @property {string|null} primaryTool
 * @property {string} checkedAt ISO timestamp; stored day-granular (YYYY-MM-DD)
 * @property {string} [verifiedBy] optional note pointing at the test file that proved this, when no new dispatch was run
 * @property {string[]} [requiredFlags] feature flags the chip needs armed at runtime
 * @property {string[]} [prereqErrors] human-readable missing-prereq details when status is FAIL
 */

const REQUIRED_FIELDS = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];

/** @param {LedgerEntry} entry @returns {string} absolute path written */
function writeLedgerEntry(entry) {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === '') {
      throw new Error(`writeLedgerEntry: missing required field "${field}"`);
    }
  }
  const dir = path.join(ROOT, entry.vertical);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${entry.useCaseId}.${entry.triggerType}.${entry.mode}.json`);
  // Store checkedAt day-granular. Callers stamp `new Date().toISOString()`, so a
  // sub-second field would rewrite all ~440 ledger files on every suite run and
  // leave the tree permanently dirty with no semantic change. Day granularity
  // keeps check-step-verification.js's staleness gate (MAX_AGE_DAYS, default 30)
  // working while making a same-day re-run byte-identical.
  const record = { ...entry, checkedAt: String(entry.checkedAt).slice(0, 10) };
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return file;
}

/** @param {string} vertical @returns {LedgerEntry[]} */
function readLedger(vertical) {
  const dir = path.join(ROOT, vertical);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

module.exports = { writeLedgerEntry, readLedger, ROOT };
