// demo_api_server/services/stepVerificationLedger.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'data', 'step-verification');

/**
 * @typedef {Object} LedgerEntry
 * @property {string} vertical
 * @property {string} useCaseId
 * @property {'chip'|'prompt'} triggerType
 * @property {'heuristic'|'llamacpp'|'helix'} mode
 * @property {'PASS'|'FAIL'} status
 * @property {string|null} errorClass one of 'server_error'|'parse_error'|'llm_error'|'wrong_response'|'wrong_gate'|'missing_prereq'|null
 * @property {string|null} primaryTool
 * @property {string} checkedAt ISO timestamp
 * @property {string} [verifiedBy] optional note pointing at the test file that proved this, when no new dispatch was run
 * @property {string[]} [requiredFlags] feature flags the chip needs armed at runtime
 * @property {string[]} [prereqErrors] human-readable missing-prereq details when status is FAIL
 * @property {string|null} [activeVertical] session/global vertical at check time
 * @property {string[]} [accountTypes] accountType values from /api/accounts/my
 * @property {'1ex'|'2ex'} [tokenSummaryMode] exchange vocabulary detected from tokenEvents
 * @property {string[]} [tokenSummaryIds] Token Summary ids present on the run
 * @property {string[]} [tokenSummaryMissing] required Token Summary ids that were absent
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
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
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
