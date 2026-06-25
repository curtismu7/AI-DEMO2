#!/usr/bin/env node
// scripts/release.js
// Cuts a new release: versions CHANGELOG.md, commits, tags, and pushes.
//
// Usage:
//   npm run release
//   npm run release -- 2026.03.26   (skip the prompt)

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CHANGELOG = path.join(__dirname, '..', 'CHANGELOG.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a shell command and stream output to the terminal. */
function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

/** Prompt the user for a value on stdin. */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

/** Return today's date as YYYY.MM.DD. */
function todayVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Changelog manipulation
// ---------------------------------------------------------------------------

/**
 * Moves the [Unreleased] block in CHANGELOG.md to a versioned section and
 * prepends a fresh empty [Unreleased] template.
 */
function stampChangelog(version) {
  const content = fs.readFileSync(CHANGELOG, 'utf8');

  const unreleasedHeader = '## [Unreleased]';
  const idx = content.indexOf(unreleasedHeader);
  if (idx === -1) throw new Error('Could not find "## [Unreleased]" in CHANGELOG.md');

  // Find the start of the next version block (next "## [") so we know where
  // [Unreleased] ends.
  const afterHeader = idx + unreleasedHeader.length;
  const nextBlockIdx = content.indexOf('\n## [', afterHeader);
  const unreleasedBody = nextBlockIdx === -1
    ? content.slice(afterHeader)
    : content.slice(afterHeader, nextBlockIdx);

  const freshUnreleased = [
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '### Fixed',
    '',
    '### Changed',
    '',
    '### Removed',
    '',
    '---',
    '',
  ].join('\n');

  const versionedSection = `## [${version}]${unreleasedBody}`;

  const before = content.slice(0, idx);
  const after = nextBlockIdx === -1 ? '' : content.slice(nextBlockIdx + 1); // +1 for the leading \n

  const updated = before + freshUnreleased + '\n' + versionedSection + (after ? '\n' + after : '');

  fs.writeFileSync(CHANGELOG, updated, 'utf8');
  console.log(`\nCHANGELOG.md: [Unreleased] → [${version}]`);
}

// ---------------------------------------------------------------------------
// Guard: uncommitted changes
// ---------------------------------------------------------------------------

function checkCleanWorkingTree() {
  const status = execSync('git status --porcelain', {
    cwd: path.join(__dirname, '..'),
  }).toString().trim();

  // Allow only CHANGELOG.md and FEATURES.md to be modified (user may have
  // updated them as part of the release workflow).
  const dirty = status
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => !/CHANGELOG\.md|FEATURES\.md/.test(l));

  if (dirty.length > 0) {
    console.error('\nAborted: working tree has uncommitted changes:\n');
    console.error(dirty.join('\n'));
    console.error('\nCommit or stash them before running npm run release.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Accept version as CLI arg or prompt
  let version = process.argv[2];
  if (!version) {
    const suggestion = todayVersion();
    version = await prompt(`Version? [${suggestion}] `);
    if (!version) version = suggestion;
  }

  if (!/^\d{4}\.\d{2}\.\d{2}([-.].*)?$/.test(version)) {
    console.error(`Invalid version "${version}". Expected format: YYYY.MM.DD or YYYY.MM.DD-suffix`);
    process.exit(1);
  }

  const tag = `v${version}`;

  // Check the tag does not already exist
  try {
    execSync(`git rev-parse --verify ${tag}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });
    console.error(`Tag ${tag} already exists. Choose a different version.`);
    process.exit(1);
  } catch (_) {
    // Tag does not exist — proceed
  }

  checkCleanWorkingTree();

  console.log(`\nReleasing ${tag}...`);

  // 1. Stamp the changelog
  stampChangelog(version);

  // 2. Commit changelog update
  run(`git add CHANGELOG.md`);
  run(`git commit -m "chore: release ${tag}"`);

  // 3. Tag
  run(`git tag -a ${tag} -m "Release ${tag}"`);

  // 4. Push commit + tag
  run(`git push`);
  run(`git push origin ${tag}`);

  console.log(`\nDone. Released ${tag}.`);
  console.log(`View on GitHub: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//;s/\\.git$//')/releases/tag/${tag}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
