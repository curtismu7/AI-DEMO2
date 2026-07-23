// demo_api_server/services/stepVerificationLedger.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'data', 'step-verification');

/**
 * @typedef {Object} LedgerEntry
 * @property {string} vertical
 * @property {string} useCaseId
 * @property {string} triggerType
 * @property {string} mode
 * @property {'PASS'|'FAIL'} status
 * @property {string|null} errorClass
 * @property {string|null} primaryTool
 * @property {string} checkedAt ISO timestamp
 * @property {string} [verifiedBy]
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
