'use strict';

const { redactValue } = require('../utils/logRedact');

const HARD_DEADLINE_MS = 900_000;
const TARGET_WARNING_MS = 720_000;
const CHECK_STATUSES = new Set(['pass', 'fail', 'blocked', 'not-run']);
const SESSION_KEY_RE = /session|^sid$/i;
const BEARER_RE = /(bearer\s+)[^\s,;]+/gi;
const TOKEN_VALUE_KEY_RE = /(?:^|_)token(?:$|_(?:value|secret|raw|jwt|credential|bearer))$/i;

function isTokenValueKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return TOKEN_VALUE_KEY_RE.test(normalized);
}

function redactReadinessValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactValue(value).replace(BEARER_RE, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redactReadinessValue);
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SESSION_KEY_RE.test(key) || isTokenValueKey(key) ? '[REDACTED]' : redactReadinessValue(item);
  }
  return redactValue(out);
}

function guardedReadinessValue(value) {
  const redacted = redactReadinessValue(value);
  const guardedPropertyValue = (property, nextValue) => {
    if (typeof property !== 'string') return guardedReadinessValue(nextValue);
    return guardedReadinessValue(redactReadinessValue({ [property]: nextValue })[property]);
  };
  const guardedHandler = {
    set(target, property, nextValue) {
      target[property] = property === 'length' ? nextValue : guardedPropertyValue(property, nextValue);
      return true;
    },
    defineProperty(target, property, descriptor) {
      if ('get' in descriptor || 'set' in descriptor) {
        throw new TypeError('Readiness report values cannot define accessor properties');
      }
      const safeDescriptor = { ...descriptor };
      if ('value' in safeDescriptor && property !== 'length') {
        safeDescriptor.value = guardedPropertyValue(property, safeDescriptor.value);
        safeDescriptor.configurable = true;
        safeDescriptor.writable = true;
      }
      return Reflect.defineProperty(target, property, safeDescriptor);
    },
    setPrototypeOf() {
      return false;
    },
  };
  if (Array.isArray(redacted)) {
    const guarded = redacted.map(guardedReadinessValue);
    return new Proxy(guarded, guardedHandler);
  }
  if (redacted && typeof redacted === 'object') {
    const guarded = Object.fromEntries(Object.entries(redacted).map(([key, item]) => [key, guardedReadinessValue(item)]));
    return new Proxy(guarded, guardedHandler);
  }
  return redacted;
}

function safeReportSnapshot(report) {
  return redactReadinessValue({
    runId: report.runId,
    commit: report.commit,
    targets: report.targets,
    startedAt: report.startedAt,
    deadlineAt: report.deadlineAt,
    status: report.status,
    ready: report.ready,
    elapsedMs: report.elapsedMs,
    targetWarning: report.targetWarning,
    inventory: report.inventory,
    checks: report.checks,
    repairs: report.repairs,
    unfinished: report.unfinished,
  });
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

  if (report.status === 'deadline_exceeded') {
    report.ready = false;
    return;
  }

  const requiredChecks = report.checks.filter((check) => check.required !== false);
  const hasUnfinished = report.unfinished.length > 0;
  report.ready = !hasUnfinished && requiredChecks.length > 0 && requiredChecks.every((check) => check.status === 'pass');
  if (report.status !== 'deadline_exceeded') {
    report.status = report.ready ? 'ready' : 'not-ready';
    if (report.checks.length === 0 && !hasUnfinished) report.status = 'running';
  }
}

function createReadinessReport({ runId, commit, targets, startedAt, deadlineAt }) {
  const report = guardedReadinessValue({
    runId,
    commit,
    targets: targets || [],
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
  });
  Object.defineProperty(report, 'toJSON', { value: () => safeReportSnapshot(report) });
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
  return report.checks[report.checks.length - 1];
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
      const safeRow = redactReadinessValue(row);
      if (safeRow.status === 'queued') return { ...safeRow, status: 'not-run', reason: 'deadline_exceeded' };
      if (safeRow.status === 'active') return { ...safeRow, status: 'blocked', reason: 'deadline_exceeded' };
      return safeRow;
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
