'use strict';

const { redactValue } = require('../utils/logRedact');

const HARD_DEADLINE_MS = 900_000;
const TARGET_WARNING_MS = 720_000;
const CHECK_STATUSES = new Set(['pass', 'fail', 'blocked', 'not-run']);
const SESSION_KEY_RE = /session|^sid$/i;
const BEARER_RE = /(bearer\s+)[^\s,;]+/gi;

function redactReadinessValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactValue(value).replace(BEARER_RE, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redactReadinessValue);
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SESSION_KEY_RE.test(key) ? '[REDACTED]' : redactReadinessValue(item);
  }
  return redactValue(out);
}

function emptyInventory() {
  return { total: 0, pass: 0, fail: 0, blocked: 0, 'not-run': 0 };
}

function refreshReport(report) {
  const inventory = emptyInventory();
  for (const check of report.checks) {
    inventory.total += 1;
    inventory[check.status] += 1;
  }
  report.inventory = inventory;

  const requiredChecks = report.checks.filter((check) => check.required !== false);
  const hasUnfinished = report.unfinished.length > 0;
  report.ready = !hasUnfinished && requiredChecks.length > 0 && requiredChecks.every((check) => check.status === 'pass');
  if (report.status !== 'deadline_exceeded') {
    report.status = report.ready ? 'ready' : 'not-ready';
    if (report.checks.length === 0 && !hasUnfinished) report.status = 'running';
  }
}

function createReadinessReport({ runId, commit, targets, startedAt, deadlineAt }) {
  const report = {
    runId: redactReadinessValue(runId),
    commit: redactReadinessValue(commit),
    targets: redactReadinessValue(targets || []),
    startedAt,
    deadlineAt,
    status: 'running',
    ready: false,
    elapsedMs: 0,
    targetWarning: false,
    inventory: emptyInventory(),
    checks: [],
    repairs: [],
    unfinished: [],
  };
  return report;
}

function recordCheck(report, row) {
  if (!CHECK_STATUSES.has(row.status)) {
    throw new Error(`Invalid readiness check status: ${row.status}`);
  }

  const check = redactReadinessValue({
    id: row.id,
    target: row.target,
    provider: row.provider,
    useCaseId: row.useCaseId,
    status: row.status,
    required: row.required !== false,
    expected: row.expected,
    observed: row.observed,
    sourceRef: row.sourceRef,
    evidence: row.evidence,
  });
  report.checks.push(check);
  refreshReport(report);
  return check;
}

function remainingBudget(report, now) {
  const elapsedMs = Math.max(0, now - report.startedAt);
  const budget = Math.max(0, report.deadlineAt - now);
  report.elapsedMs = elapsedMs;
  report.targetWarning = elapsedMs >= TARGET_WARNING_MS;

  if (budget === 0) {
    report.status = 'deadline_exceeded';
    report.ready = false;
    report.unfinished = report.unfinished.map((row) => {
      if (row.status === 'queued') return { ...row, status: 'not-run', reason: 'deadline_exceeded' };
      if (row.status === 'active') return { ...row, status: 'blocked', reason: 'deadline_exceeded' };
      return row;
    });
  }
  return budget;
}

module.exports = {
  HARD_DEADLINE_MS,
  TARGET_WARNING_MS,
  createReadinessReport,
  recordCheck,
  redactReadinessValue,
  remainingBudget,
};
