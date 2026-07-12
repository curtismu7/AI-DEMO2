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
function aggregateVerdict(results) {
  if (results.some((r) => r.status === 'fail')) return VERDICT.NOT_READY;
  if (results.some((r) => r.status === 'warn')) return VERDICT.WARN;
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
      outcome = { status: 'fail', detail: err.message };
    }
    if (!outcome || typeof outcome !== 'object') outcome = { status: 'fail', detail: 'check returned no result' };
    const result = {
      id: check.id, name: check.name, category: check.category,
      status: outcome.status, detail: outcome.detail || '', meta: outcome.meta || null,
      durationMs: Date.now() - start,
    };
    results.push(result);
    onResult(result);
  }
  return results;
}

module.exports = { currentFlags, selectChecks, aggregateVerdict, runChecks, VERDICT };
