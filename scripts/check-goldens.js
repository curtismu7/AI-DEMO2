#!/usr/bin/env node
'use strict';
/**
 * check-goldens.js — drift gate for the Layer-3 demo fallback (REPLAY goldens).
 *
 * A golden that disagrees with the current catalog would replay FICTION with a
 * straight face — worse than no fallback. Rules:
 *   - STALE (fail): a golden's trigger or expectedOutcome no longer matches the
 *     catalog's resolved entry for that (vertical, useCaseId).
 *   - MALFORMED (fail): missing required fields.
 *   - MISSING (warn only): a catalog chip with no golden yet. Capturing needs a
 *     healthy live stack + login, so absence must not block unrelated pushes —
 *     but the count is printed so demo prep can see coverage.
 *
 * Regenerate: run demo_api_ui/tests/e2e/capture-goldens.real.spec.js against a
 * healthy stack (see its header for the command).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOLDENS = path.join(ROOT, 'demo_api_server', 'data', 'goldens');
const REQUIRED = ['vertical', 'useCaseId', 'trigger', 'capturedAt', 'reply'];
const crypto = require('crypto');
const MAX_AGE_DAYS = Number(process.env.GOLDEN_MAX_AGE_DAYS || 30);

/** Current seed hash for a vertical (null when no static seed — e.g. banking). */
function seedHashFor(vertical) {
  const seed = path.join(ROOT, 'demo_api_server', 'config', 'verticals', vertical, 'seed.json');
  if (!fs.existsSync(seed)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex').slice(0, 16);
}
const A2A_UNROUTABLE = /specialist/i;

function catalogChips() {
  const { USE_CASES, VERTICALS, resolveUseCase } = require(path.join(ROOT, 'demo_api_server', 'config', 'useCases.js'));
  const out = new Map(); // `${vertical}/${useCaseId}` -> { trigger, expectedOutcome }
  for (const vertical of VERTICALS) {
    const seen = new Set();
    for (const u of USE_CASES) {
      const uc = resolveUseCase(u.id, vertical) || u;
      const t = uc.trigger || {};
      if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text) || seen.has(t.text)) continue;
      seen.add(t.text);
      if (uc.useCaseId) out.set(`${vertical}/${uc.useCaseId}`, { trigger: t.text, expectedOutcome: uc.expectedOutcome || null });
    }
  }
  return out;
}

function checkGoldens() {
  const failures = [];
  const warnings = [];
  let oldestDays = 0;
  const chips = catalogChips();
  const seen = new Set();

  if (fs.existsSync(GOLDENS)) {
    for (const vertical of fs.readdirSync(GOLDENS)) {
      const dir = path.join(GOLDENS, vertical);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        const key = `${vertical}/${f.replace(/\.json$/, '')}`;
        let g;
        try {
          g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch (e) {
          failures.push(`[malformed] ${key}: ${e.message}`);
          continue;
        }
        for (const field of REQUIRED) {
          if (g[field] == null || g[field] === '') failures.push(`[malformed] ${key}: missing "${field}"`);
        }
        const cat = chips.get(key);
        if (!cat) {
          failures.push(`[orphan] ${key}: no such catalog chip any more — delete the golden or fix the catalog`);
          continue;
        }
        seen.add(key);
        if (g.trigger !== cat.trigger) {
          failures.push(`[stale] ${key}: golden trigger ${JSON.stringify(g.trigger)} != catalog ${JSON.stringify(cat.trigger)} — re-capture`);
        }
        if ((g.expectedOutcome || null) !== (cat.expectedOutcome || null)) {
          failures.push(`[stale] ${key}: golden expectedOutcome ${JSON.stringify(g.expectedOutcome || null)} != catalog ${JSON.stringify(cat.expectedOutcome || null)} — re-capture`);
        }
        // VALUE drift: the seed the replay's numbers came from has changed.
        // Trigger/outcome still match, but the replay would show outdated data
        // with a straight face — same fiction class as a stale trigger.
        const nowHash = seedHashFor(vertical);
        if (nowHash && g.seedHash && g.seedHash !== nowHash) {
          failures.push(`[seed-drift] ${key}: ${vertical}'s seed.json changed since capture — replay values are outdated, re-capture`);
        }
        const days = (Date.now() - Date.parse(g.capturedAt)) / 86400000;
        if (Number.isFinite(days)) {
          oldestDays = Math.max(oldestDays, Math.floor(days));
          if (days > MAX_AGE_DAYS) warnings.push(`[age] ${key}: captured ${Math.floor(days)}d ago (> ${MAX_AGE_DAYS}d) — consider re-capturing before the next demo`);
        }
      }
    }
  }

  const missing = [...chips.keys()].filter((k) => !seen.has(k));
  return { failures, warnings, oldestDays, missing, covered: seen.size, total: chips.size };
}

if (require.main === module) {
  const { failures, warnings, oldestDays, missing, covered, total } = checkGoldens();
  console.log(`[check-goldens] replay coverage: ${covered}/${total} catalog chips have goldens` +
    (missing.length ? ` (${missing.length} missing — capture with capture-goldens.real.spec.js)` : '') +
    (covered ? `; oldest capture ${oldestDays}d ago` : ''));
  for (const w of warnings) console.warn('  ' + w);
  if (failures.length) {
    console.error('[check-goldens] FAILED:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[check-goldens] OK — no stale, orphaned, or malformed goldens.');
}

module.exports = { checkGoldens, catalogChips, GOLDENS };
