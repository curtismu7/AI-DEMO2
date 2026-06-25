'use strict';

/**
 * Append-only NDJSON audit log writer for the portable encrypted credential
 * vault (Phase 269).
 *
 * Strict separation of concerns: this module MUST NOT require ./crypto or
 * ./format. By construction, it has no path to a decrypted value — the only
 * fields it accepts are { op, key, result, caller }. Any other field throws
 * before the line hits disk.
 *
 * Each line written is one synchronous appendFileSync of
 *   JSON.stringify({ts,op,key,pid,caller,host,result}) + '\n'
 * so concurrent calls cannot interleave bytes within a line.
 *
 * Write failures (e.g. read-only audit dir) are NON-FATAL — they log via
 * console.warn but do not throw, so the caller's primary operation succeeds
 * even if the audit channel is unavailable.
 */

const fs = require('node:fs');
const os = require('node:os');

const ALLOWED = new Set(['op', 'key', 'result', 'caller']);

/**
 * Append one audit record to `filePath` as NDJSON.
 *
 * @param {string} filePath
 * @param {{op: string, key: (string|null|undefined), result: string, caller: string}} entry
 * @returns {void}
 */
function recordAudit(filePath, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('recordAudit: entry must be an object');
  }
  for (const k of Object.keys(entry)) {
    if (!ALLOWED.has(k)) {
      throw new Error('recordAudit: unexpected field ' + k);
    }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    op: entry.op,
    key: entry.key ?? null,
    pid: process.pid,
    caller: entry.caller,
    host: os.hostname(),
    result: entry.result,
  }) + '\n';
  try {
    fs.appendFileSync(filePath, line, { flag: 'a' });
  } catch (err) {
    // Audit-write failure must not propagate. The operator's primary action
    // (open/read/set/save/...) succeeds; the audit channel is best-effort.
    // eslint-disable-next-line no-console
    console.warn('[vault.audit] write failed:', err.message);
  }
}

module.exports = { recordAudit };
