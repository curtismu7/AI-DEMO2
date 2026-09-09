#!/usr/bin/env node
'use strict';
/**
 * Dead-module scan that resolves MOCK references, not just require()/import.
 *
 * A module named only by `jest.mock('../services/x')` is invisible to a
 * require()-only scan: deleting it breaks no import, so `node -e
 * "require('./server.js')"` still boots clean. It breaks jest's resolver at
 * mock time, and the signature is a suite that FAILS TO RUN with 0 failed
 * tests -- which does not read as a missing module. That is what bit #2521
 * (services/configHostnameService.js), and TECH_DEBT 2026-08-28 asked for the
 * resolver to live in the repo instead of being rebuilt from memory each time.
 *
 * Covers both runners deliberately: demo_api_server is jest, demo_api_ui is
 * vitest, and vi.mock() has exactly the same invisibility.
 *
 *   node scripts/find-unreferenced-modules.js demo_api_server
 *   node scripts/find-unreferenced-modules.js --self-test
 */
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'build']);
const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];

// Every form that makes a module load-bearing. Mock forms are the whole point:
// omit them and the scan confidently reports a live module as dead.
const REF_PATTERNS = [
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\b(?:jest|vi)\s*\.\s*(?:mock|doMock|unmock|requireActual|importActual|requireMock)\s*\(\s*['"]([^'"]+)['"]/g,
  // Runner config names its setup/teardown/reporter files as PATH STRINGS
  // (globalSetup, setupFiles, testResultsProcessor, moduleNameMapper). Same
  // invisibility as a mock: no require(), so a require-only scan calls them dead.
  /['"](<rootDir>\/[^'"]+)['"]/g,
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (EXTS.includes(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/** Every relative specifier referenced anywhere in `text`. */
function referencesIn(text) {
  const out = [];
  for (const re of REF_PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) {
      const spec = m[1].startsWith('<rootDir>/') ? './' + m[1].slice('<rootDir>/'.length) : m[1];
      if (spec.startsWith('.')) out.push(spec);
    }
  }
  return out;
}

/** Resolve a specifier the way Node/jest do: exact, +ext, then /index. */
function resolveRef(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))];
  return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

/**
 * Roots are the files something outside the graph runs: entry points, tests,
 * scripts and config. Anything a root cannot reach is dead. "Referenced by
 * nothing" is the wrong question -- every test file would answer yes to it.
 */
function isRoot(f) {
  const b = path.basename(f);
  return /\.(test|spec)\.[jt]sx?$/.test(b)
    || /^(server|index|app|main)\.[jt]s$/.test(b)
    || /\/(scripts|bin|migrations)\//.test(f)
    || /(jest|vite|vitest|playwright|babel|eslint)[.\w-]*\.config\.[jt]s$/.test(b)
    || /^newrelic\.js$/.test(b)
    || /setupTests?\.[jt]s$/.test(b);
}

function unreferenced(root, { rootsOnly = false } = {}) {
  const files = walk(path.resolve(root));
  const edges = new Map();
  for (const f of files) {
    const outs = [];
    for (const spec of referencesIn(fs.readFileSync(f, 'utf8'))) {
      const r = resolveRef(f, spec);
      if (r) outs.push(r);
    }
    edges.set(f, outs);
  }
  if (rootsOnly) {
    // Plain "referenced by nothing" -- used by the self-test, where there is
    // no entry point to walk from.
    const referenced = new Set([].concat(...edges.values()));
    return files.filter((f) => !referenced.has(f));
  }
  const seen = new Set();
  const stack = files.filter(isRoot);
  for (const r of stack) seen.add(r);
  while (stack.length) {
    for (const next of edges.get(stack.pop()) || []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return files.filter((f) => !seen.has(f));
}

/** The #2521 regression: a mock-only reference must count as a reference. */
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'unref-'));
  fs.writeFileSync(path.join(tmp, 'mockOnly.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(tmp, 'viMockOnly.js'), 'export default 1;\n');
  fs.writeFileSync(path.join(tmp, 'trulyDead.js'), 'module.exports = 2;\n');
  fs.writeFileSync(
    path.join(tmp, 'a.test.js'),
    "jest.mock('./mockOnly');\nvi.mock('./viMockOnly');\n",
  );
  const dead = unreferenced(tmp, { rootsOnly: true }).map((f) => path.basename(f)).sort();
  const assert = require('assert');
  assert.deepStrictEqual(dead, ['a.test.js', 'trulyDead.js'],
    `mock-only modules must not be reported dead; got ${JSON.stringify(dead)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('self-test OK: jest.mock/vi.mock references keep a module alive');
}

const arg = process.argv[2];
if (!arg || arg === '--self-test') { selfTest(); process.exit(0); }
const dead = unreferenced(arg);
console.log(dead.length ? dead.join('\n') : '(no unreferenced modules)');
console.error(`\n${dead.length} unreferenced of ${walk(path.resolve(arg)).length} scanned in ${arg}`);
