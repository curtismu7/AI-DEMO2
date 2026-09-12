#!/usr/bin/env node
/**
 * check-root-allowlist.js — repo-root orphan-import guard.
 *
 * PR #370 (2026-07-12) bulk-imported 5,460 files in one commit and dumped
 * 40+ unrelated top-level files/dirs into the repo root (stray one-off
 * exports, duplicate skill bundles, a leaked-looking credential, generated
 * debug output) — nothing enumerated the repo root, so nothing caught it.
 *
 * scripts/root-allowlist.txt is the source of truth. Add a genuine new
 * top-level dir/file to it in the SAME PR that adds the entry; anything
 * else unlisted fails the gate.
 *
 * Reads `git ls-files` (tracked files only), so gitignored/untracked paths
 * never reach this check — they can't land in a PR diff either.
 *
 * Wired into CI (gates job). Run locally: npm run root:allowlist:check
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ALLOWLIST_PATH = path.join(__dirname, 'root-allowlist.txt');

const allowlist = new Set(
  fs
    .readFileSync(ALLOWLIST_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
);

// core.quotepath=false: filenames with unusual characters (e.g. the PDF at
// root) would otherwise come back C-quoted and corrupt the top-level split.
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const topLevel = new Set(tracked.map((f) => f.split('/')[0]));

const unlisted = [...topLevel].filter((e) => !allowlist.has(e)).sort();

if (unlisted.length) {
  console.error('✗ New top-level entries not on scripts/root-allowlist.txt:\n');
  for (const e of unlisted) console.error(`  ${e}`);
  console.error(
    '\nRoot stays limited to what CLAUDE.md documents. If this is a real new ' +
      'top-level service/doc, add it to scripts/root-allowlist.txt in this PR. ' +
      'If it landed by accident (a stray export, a debug dump, a duplicate), ' +
      'remove it instead.',
  );
  process.exit(1);
}
console.log(`✓ Root allowlist: all ${topLevel.size} top-level entries are listed.`);
