#!/usr/bin/env node
'use strict';

/**
 * scripts/check-pytest-asyncio-markers.js
 *
 * Fails when a Python service running pytest-asyncio in STRICT mode has an
 * `async def test_*` without `@pytest.mark.asyncio`.
 *
 * Why this is worth a gate rather than a convention note: in strict mode an
 * unmarked async test is still COLLECTED, but its coroutine is never awaited.
 * It reports green having executed none of its assertions. That is false
 * coverage, which is worse than no coverage — the suite says the path is tested
 * and nothing ran. A missing marker produces no warning and no failure, so
 * nothing else in CI can notice it.
 *
 * Strict-vs-auto is DERIVED, never hardcoded: a service is exempt only if one
 * of its pytest configs declares `asyncio_mode = auto`. Today that is
 * langchain_agent alone (pytest.ini). openai_agent and pydantic_agent ship no
 * pytest config at all, so pytest-asyncio defaults to strict there. Deriving
 * means this self-corrects both ways — add `asyncio_mode = auto` to a service
 * and its markers stop being required; delete it and they start being required
 * the same day.
 *
 * Usage: node scripts/check-pytest-asyncio-markers.js
 * Exit 0 = clean. Exit 1 = at least one unmarked async test.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', 'venv', '.venv', '__pycache__',
  'dist', 'build', '.pytest_cache', 'site-packages',
]);
const CONFIG_FILES = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini'];

function pythonTestFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) pythonTestFiles(p, out);
    else if (/^test_.*\.py$/.test(entry.name) || /_test\.py$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Nearest ancestor (up to ROOT) declaring `asyncio_mode = auto`. */
function isAutoMode(fileDir) {
  let dir = fileDir;
  while (dir.startsWith(ROOT)) {
    for (const cfg of CONFIG_FILES) {
      const p = path.join(dir, cfg);
      if (!fs.existsSync(p)) continue;
      if (/asyncio_mode\s*=\s*["']?auto["']?/.test(fs.readFileSync(p, 'utf8'))) return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Decorators sit contiguously above the def. Walk up over decorator lines and
 * their wrapped continuations, stopping at the first real statement.
 */
function hasAsyncioMarker(lines, defIdx) {
  for (let i = defIdx - 1; i >= 0; i--) {
    const line = lines[i];
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('@')) {
      if (/^@(pytest\.mark\.asyncio|.*\.asyncio)\b/.test(t)) return true;
      continue;
    }
    // A wrapped decorator argument list — keep walking; anything else ends it.
    if (/^[)\]}]/.test(t) || /^["'\w].*[,)]$/.test(t)) continue;
    return false;
  }
  return false;
}

const violations = [];
let strictFilesScanned = 0;

for (const file of pythonTestFiles(ROOT)) {
  const dir = path.dirname(file);
  if (isAutoMode(dir)) continue; // auto mode — no marker needed
  const src = fs.readFileSync(file, 'utf8');
  // Module- or class-level `pytestmark = pytest.mark.asyncio` covers the file.
  if (/^\s*pytestmark\s*=.*asyncio/m.test(src)) continue;

  strictFilesScanned++;
  const lines = src.split('\n');
  lines.forEach((line, idx) => {
    if (!/^\s*async\s+def\s+test_/.test(line)) return;
    if (hasAsyncioMarker(lines, idx)) return;
    violations.push({
      file: path.relative(ROOT, file),
      line: idx + 1,
      name: (line.match(/async\s+def\s+(test_\w+)/) || [, '?'])[1],
    });
  });
}

if (violations.length > 0) {
  console.error(
    `[check-pytest-asyncio-markers] ${violations.length} async test(s) missing ` +
      `@pytest.mark.asyncio in a strict-mode service:\n`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.name}`);
  console.error(
    `\nIn strict mode pytest-asyncio collects these but never awaits them, so ` +
      `they PASS without running a single assertion. Add @pytest.mark.asyncio ` +
      `above each, or give the service a pytest config with asyncio_mode = auto ` +
      `(as langchain_agent has).`,
  );
  process.exit(1);
}

console.log(
  `[check-pytest-asyncio-markers] OK — ${strictFilesScanned} strict-mode test ` +
    `file(s) scanned, every async test carries @pytest.mark.asyncio.`,
);
