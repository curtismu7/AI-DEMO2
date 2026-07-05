#!/usr/bin/env node
/**
 * check-regression-plan-paths.js — REGRESSION_PLAN.md §1 anti-rot guard.
 *
 * Every file referenced in the §1 protected-areas table must still exist in
 * the repo, otherwise the do-not-break contract silently protects nothing
 * (found in the 2026-07 process review: three rows still named
 * BankingAgent.js/.css months after the component was renamed to AIAgent).
 *
 * §1 paths are shorthand (e.g. `routes/oauth.js`, `UserDashboard.js`), so a
 * token passes if any TRACKED file equals it or ends with `/<token>`.
 * Tokens containing `*` are treated as globs. Non-file tokens (code
 * identifiers, endpoints) and gitignored `.env` files are skipped.
 *
 * Wired into CI (gates job). Run locally: npm run regression:paths
 */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLAN = path.join(ROOT, 'REGRESSION_PLAN.md');

const FILE_EXT_RE = /\.(js|jsx|ts|tsx|css|json|mjs|cjs|py|sh|groovy|ya?ml|md)$/;

function sectionOneRows(md) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^## §1\b/.test(l));
  if (start === -1) throw new Error('REGRESSION_PLAN.md: no "## §1" heading found');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    if (/^\|/.test(lines[i]) && !/^\|\s*-+/.test(lines[i]) && !/^\|\s*Area\s*\|/i.test(lines[i])) {
      rows.push({ line: i + 1, text: lines[i] });
    }
  }
  return rows;
}

function fileTokens(rowText) {
  const tokens = [...rowText.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return tokens.filter(
    (t) =>
      FILE_EXT_RE.test(t) &&
      !t.includes('(') &&
      !t.includes('?') &&
      !t.includes(' ') &&
      !/(^|\/)\.env/.test(t) &&
      !t.endsWith('.env'),
  );
}

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

function exists(token) {
  if (token.includes('*')) {
    const re = new RegExp(
      '(^|/)' + token.split('*').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$',
    );
    return tracked.some((f) => re.test(f));
  }
  return tracked.some((f) => f === token || f.endsWith('/' + token));
}

const md = fs.readFileSync(PLAN, 'utf8');
const missing = [];
for (const row of sectionOneRows(md)) {
  for (const token of fileTokens(row.text)) {
    if (!exists(token)) missing.push({ token, line: row.line });
  }
}

if (missing.length) {
  console.error('✗ REGRESSION_PLAN.md §1 references files that do not exist in the repo:\n');
  for (const m of missing) {
    console.error(`  REGRESSION_PLAN.md:${m.line}  \`${m.token}\``);
  }
  console.error(
    '\nFix the §1 row (the file was moved/renamed/deleted) so the do-not-break contract tracks reality.',
  );
  process.exit(1);
}
console.log('✓ REGRESSION_PLAN.md §1: all referenced files exist.');
