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
 * Write failures are handled by OP CLASS:
 *
 *   - MUTATING ops (set/delete/rotate/save) FAIL CLOSED. A swallowed failure
 *     here meant `chmod 0444 secrets.vault.audit.log` silenced the entire trail
 *     while every vault operation kept succeeding — a local attacker could
 *     mutate the vault leaving no record. Tamper-evidence is the point of the
 *     log, so a mutation that cannot be recorded must not happen.
 *   - NON-MUTATING ops (open/read/close) stay best-effort and only warn, so an
 *     unwritable log cannot brick a BFF that is merely reading secrets at boot.
 *
 * The audit file is created 0600 to match the vault itself; it was previously
 * left at the process umask (0644 in practice), publishing the full entry-name
 * inventory and every bad_password event to any local user.
 */

const fs = require('node:fs');
const os = require('node:os');

const ALLOWED = new Set(['op', 'key', 'result', 'caller']);

// Operations that change vault state AND are recorded before anything persists,
// so throwing here leaves no on-disk change. `save` is deliberately absent: it
// audits after the rename, so failing there would report an error for a mutation
// that already landed. `assertAuditWritable()` at open covers that case instead.
const MUTATING_OPS = new Set(['set', 'delete', 'rotate']);

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
    // mode applies only when appendFileSync creates the file; an existing log
    // keeps its current mode, so this cannot fight an operator's chmod.
    fs.appendFileSync(filePath, line, { flag: 'a', mode: 0o600 });
  } catch (err) {
    if (MUTATING_OPS.has(entry.op)) {
      // Fail closed: an unrecordable mutation must not proceed.
      const e = new Error(
        `vault: refusing to ${entry.op} — audit log is not writable (${err.code || err.message})`,
      );
      e.code = 'VAULT_AUDIT_UNWRITABLE';
      throw e;
    }
    // Non-mutating (open/read/close): best-effort, so an unwritable log cannot
    // stop a process from reading secrets it already has the password for.
    // eslint-disable-next-line no-console
    console.warn('[vault.audit] write failed:', err.message);
  }
}

/**
 * Throw unless `filePath` can be appended to. Called once when a vault is opened
 * or created so the "silence the log, then mutate" path fails before any
 * mutation is possible — `save()` records after its rename and so cannot fail
 * closed on its own.
 *
 * @param {string} filePath
 * @returns {void}
 */
function assertAuditWritable(filePath) {
  try {
    fs.appendFileSync(filePath, '', { flag: 'a', mode: 0o600 });
  } catch (err) {
    const e = new Error(
      `vault: audit log is not writable (${err.code || err.message}) — refusing to open`,
    );
    e.code = 'VAULT_AUDIT_UNWRITABLE';
    throw e;
  }
}

module.exports = { recordAudit, assertAuditWritable };
