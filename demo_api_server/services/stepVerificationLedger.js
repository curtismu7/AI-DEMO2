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
 * @property {'PASS'|'UNPROVEN'|'FAIL'} status
 *   PASS     — the check exercised the behaviour and it was correct.
 *   UNPROVEN — the check ran and found no defect, but it never exercised the
 *              behaviour: the runtime conditions were stubbed, so it proves only
 *              that the catalog DECLARES the right thing. Does not count as coverage.
 *   FAIL     — the check exercised the behaviour and it was wrong, or a
 *              prerequisite it needs was missing.
 * @property {string|null} errorClass one of 'server_error'|'parse_error'|'llm_error'|'wrong_response'|'wrong_gate'|'missing_prereq'|'exchange_failed'|'empty_token_events'|'failure_without_detail'|'no_event_detail'|null
 * @property {string|null} primaryTool
 * @property {string} checkedAt ISO timestamp; stored day-granular (YYYY-MM-DD)
 * @property {string} [verifiedBy] optional note pointing at the test file that proved this, when no new dispatch was run
 * @property {string[]} [requiredFlags] feature flags the chip needs armed at runtime
 * @property {string[]} [prereqErrors] human-readable missing-prereq details when status is FAIL
 * @property {boolean} [configAssumedPresent] offline stub supplied declared non-flag config
 */

const REQUIRED_FIELDS = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];

const STATUSES = ['PASS', 'UNPROVEN', 'FAIL'];

// Day granularity (below) makes a SAME-day re-run byte-identical, but a re-run
// on any later day still rewrote every ledger file with only the date changed —
// measured 2026-08-18: one full suite run produced a 537-file diff of pure
// checkedAt churn. In the main checkout those tracked-file modifications also
// make sync-main-checkout.sh back off, which is the silently-stale-stack
// failure mode. So an unchanged verdict is only re-stamped once its stored date
// is older than this — half of check-step-verification.js's MAX_AGE_DAYS (30,
// warn-only), so a row that keeps re-verifying refreshes ~fortnightly and can
// never reach the staleness warning, while day-to-day runs leave the tree clean.
const REFRESH_AGE_DAYS = 15;

/**
 * Key-order-independent stringify, so "unchanged" survives caller field order.
 * Skips undefined-valued keys exactly as JSON.stringify does — callers pass
 * optional fields as undefined, and the stored file has no such keys, so
 * keeping them would make every comparison miss.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fields a writer stamps on itself to say its PASS is not runtime evidence.
 * Read in one place so the rule cannot be honoured by some writers and forgotten
 * by others.
 *
 * `flagsOffDetected` is the negative control from tests/helpers/chipPrerequisites.js:
 * the declared flags the prerequisite check noticed when they were forced OFF. A
 * non-empty value means the check itself works — it does NOT mean the flags were
 * off in the recorded run. It still disqualifies the entry as coverage, because
 * producing one requires a stubbed flag store rather than a real one.
 *
 * @param {LedgerEntry} entry
 * @returns {string[]} names of the signals present
 */
function unprovenSignals(entry) {
  const signals = [];
  if (entry.provesDeclaredOnly === true) signals.push('provesDeclaredOnly');
  if (entry.flagsAssumedOn === true) signals.push('flagsAssumedOn');
  // Declared non-flag config (PAR / A2A credentials) was supplied by the offline
  // stub rather than read from a real store, so the check proves the catalog
  // DECLARES those prerequisites, not that any environment has them.
  if (entry.configAssumedPresent === true) signals.push('configAssumedPresent');
  if (Array.isArray(entry.flagsOffDetected) && entry.flagsOffDetected.length > 0) {
    signals.push('flagsOffDetected');
  }
  return signals;
}

/** @param {LedgerEntry} entry @returns {string} absolute path written */
function writeLedgerEntry(entry) {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === '') {
      throw new Error(`writeLedgerEntry: missing required field "${field}"`);
    }
  }
  if (!STATUSES.includes(entry.status)) {
    throw new Error(
      `writeLedgerEntry: unknown status "${entry.status}" — expected one of ${STATUSES.join(', ')}`,
    );
  }
  const dir = path.join(ROOT, entry.vertical);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${entry.useCaseId}.${entry.triggerType}.${entry.mode}.json`);
  // Store checkedAt day-granular. Callers stamp `new Date().toISOString()`, so a
  // sub-second field would rewrite all ~440 ledger files on every suite run and
  // leave the tree permanently dirty with no semantic change. Day granularity
  // keeps check-step-verification.js's staleness gate (MAX_AGE_DAYS, default 30)
  // working while making a same-day re-run byte-identical.
  // Downgrade here rather than at each call site: 20+ suites stamp a status, and
  // a rule enforced in one of them is a rule the other 19 can forget. FAIL is
  // never downgraded — a defect found under stubbed conditions is still a defect.
  const status = entry.status === 'PASS' && unprovenSignals(entry).length > 0
    ? 'UNPROVEN'
    : entry.status;
  const record = { ...entry, status, checkedAt: String(entry.checkedAt).slice(0, 10) };
  if (fs.existsSync(file)) {
    try {
      const { checkedAt: prevAt, ...prevRest } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { checkedAt: _nextAt, ...nextRest } = record;
      const ageDays = (Date.now() - Date.parse(prevAt)) / 86400000;
      if (
        stableStringify(prevRest) === stableStringify(nextRest)
        && Number.isFinite(ageDays)
        && ageDays < REFRESH_AGE_DAYS
      ) {
        return file; // unchanged verdict, fresh date — no churn
      }
    } catch (_) { /* unreadable existing file — fall through and rewrite it */ }
  }
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

module.exports = { writeLedgerEntry, readLedger, unprovenSignals, STATUSES, ROOT };
