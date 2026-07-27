'use strict';
const { FLAG_REGISTRY, serializeFlag } = require('../routes/featureFlags');

/** Current feature-flag values as { id: value }. */
function currentFlags() {
  const out = {};
  for (const f of FLAG_REGISTRY) out[f.id] = serializeFlag(f).value;
  return out;
}

/** Filter checks by appliesWhen + heavy. `list` defaults to the shared registry. */
function selectChecks(flags, { includeHeavy = false } = {}, list) {
  const checks = list || require('./checks/registry').ALL_CHECKS;
  return checks.filter((c) => {
    if (c.heavy && !includeHeavy) return false;
    return typeof c.appliesWhen === 'function' ? !!c.appliesWhen(flags) : true;
  });
}

const VERDICT = { READY: 'ready', WARN: 'ready_with_warnings', NOT_READY: 'not_ready' };

/**
 * Severity-aware verdict (Demo check):
 * - gate | blocking fail → not_ready
 * - advisory fail or any warn → ready_with_warnings (if no hard fail)
 * - else ready
 * Unspecified severity is treated as blocking (safe default).
 */
function resultSeverity(r) {
  return r.severity || 'blocking';
}

function aggregateVerdict(results) {
  const hardFail = results.some(
    (r) => r.status === 'fail' && resultSeverity(r) !== 'advisory',
  );
  if (hardFail) return VERDICT.NOT_READY;
  const softIssue = results.some(
    (r) => r.status === 'warn' || (r.status === 'fail' && resultSeverity(r) === 'advisory'),
  );
  if (softIssue) return VERDICT.WARN;
  return VERDICT.READY;
}

/** Run checks in order, streaming each result via onResult. Never throws. */
async function runChecks(checks, ctx, onResult = () => {}) {
  const results = [];
  for (const check of checks) {
    const start = Date.now();
    let outcome;
    try {
      outcome = await check.run(ctx);
    } catch (err) {
      // err.message can be empty (or err may not be an Error at all), and the
      // bare version produced `detail: ""` — a GATE check failing with no
      // reason whatsoever, which is unusable 10 minutes before a demo.
      // Observed live on gateway.real_path: status fail, detail "", meta null.
      // Deliberately NOT String(err): for `new Error('')` that yields the
      // useless literal "Error", which is barely better than the empty string
      // it replaced. Use the real message, or say plainly that there was none.
      const raw = err && typeof err === 'object' ? err.message : err;
      const msg = typeof raw === 'string' ? raw : '';
      const where = err && err.stack ? String(err.stack).split('\n')[1] : '';
      outcome = {
        status: 'fail',
        detail: msg.trim()
          || (err && err.code ? `${err.code}` : '')
          || `check threw ${err && err.name ? err.name : 'a non-Error'} with no message${where ? ` ${where.trim()}` : ''}`,
        meta: { thrown: true, name: err && err.name, code: err && err.code },
      };
    }
    if (!outcome || typeof outcome !== 'object') outcome = { status: 'fail', detail: 'check returned no result' };
    const result = {
      id: check.id,
      name: check.name,
      category: check.category,
      status: outcome.status,
      detail: outcome.detail || '',
      meta: outcome.meta || null,
      nextAction: outcome.nextAction || null,
      severity: check.severity || 'blocking',
      durationMs: Date.now() - start,
    };
    results.push(result);
    onResult(result);
  }
  return results;
}

module.exports = { currentFlags, selectChecks, aggregateVerdict, runChecks, VERDICT };
