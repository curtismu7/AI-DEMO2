#!/usr/bin/env node
'use strict';
/**
 * Mock-drift gate — scripts/check-mock-drift.js
 *
 * Root cause this guards against (2026-09-26 postmortem): routes/ciba.js gained
 * calls to cibaSimulatedService.isLocalSimulationEnabled() in 2ed20dd1b, but the
 * jest.mock factory in src/__tests__/ciba.test.js was never updated. Every
 * failover-branch test then threw TypeError — 11 failures locally, 120 in CI —
 * and stayed red for days because main's CI had no green baseline to compare
 * against (see scripts/check-mock-drift.test.js for the exact shapes).
 *
 * The class of bug: a production module EXPORTS or CALLS a function that a test
 * file's jest.mock factory does not provide. When the mock omits an export the
 * router dereferences, the failure is a TypeError inside the route under test —
 * hard to read, easy to mistake for a product bug, and invisible when CI is red
 * for unrelated reasons.
 *
 * What this check does (static, dependency-free, hermetic):
 *   For every jest.mock('<relative module>', factoryFn) in demo_api_server test
 *   files where the factory is an OBJECT LITERAL of jest.fn()/values, compare
 *   its keys against the exports of the real module (function-style exports via
 *   `function name(` / `name,` in module.exports / module.exports = { ... }).
 *   Fail when the real module exports a FUNCTION that the mock object omits
 *   AND that export name appears as a member call (`x.name(`) in a route or
 *   service source file — i.e. it is actually load-bearing.
 *
 * Deliberately narrow: only object-literal factories (the drift-prone kind),
 * only demo_api_server (where the ciba incident happened), only load-bearing
 * exports. Broader inference produced false positives in trial runs; this
 * check must stay quiet-by-default so a red means a real drift.
 *
 * Exit 0 = no drift. Exit 1 = drift found (names the file, mock, and export).
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SRV = path.join(REPO, 'demo_api_server');

function listFiles(dir, ext, out = []) {
  for (const entry of fs.readdirSync(path.join(SRV, ...dir), { withFileTypes: true })) {
    const rel = [...dir, entry.name];
    if (entry.isDirectory() && entry.name !== 'node_modules') collect(rel, ext, out);
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(path.join(SRV, ...rel));
  }
  return out;
}
function collect(dir, ext, out) { listFiles(dir, ext, out); }

function extractJestMockFactories(source) {
  // jest.mock('path', () => ({ key: jest.fn(), ... }))
  const factories = [];
  const re = /jest\.mock\(\s*['"]([^'"]+)['"]\s*,\s*\(\s*\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const keys = [];
    const keyRe = /^\s*([A-Za-z_$][\w$]*)\s*:/gm;
    let k;
    while ((k = keyRe.exec(m[2])) !== null) keys.push(k[1]);
    factories.push({ module: m[1], keys, index: m.index });
  }
  return factories;
}

function extractRealExports(servicePath) {
  let src;
  try { src = fs.readFileSync(servicePath, 'utf8'); } catch { return null; }
  const fns = new Set();
  // module.exports = { a, b, fn1, ... } — shorthand and explicit function values
  const expRe = /module\.exports\s*=\s*\{([\s\S]*?)\}/;
  const em = expRe.exec(src);
  if (em) {
    for (const part of em[1].split(',')) {
      const name = part.trim().split(/[:=(]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) fns.add(name);
    }
  }
  // exports.foo = ... / module.exports.foo = ...
  const dotRe = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm;
  let d;
  while ((d = dotRe.exec(src)) !== null) fns.add(d[1]);
  return fns;
}

function resolveModule(fromTestFile, spec) {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(fromTestFile), spec);
  for (const cand of [abs, `${abs}.js`]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// All route/service source files, read ONCE. isLoadBearer then runs regexes
// over in-memory strings — scanning 543 files per export name was the first
// draft's timeout (2026-09-26).
const SOURCE_FILES = (() => {
  const files = [];
  for (const root of ['routes', 'services']) {
    const dir = path.join(SRV, root);
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const dirPath = stack.pop();
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const p = path.join(dirPath, entry.name);
        if (entry.isDirectory()) stack.push(p);
        else if (entry.name.endsWith('.js')) files.push(p);
      }
    }
  }
  return files;
})();

const SOURCE_TEXT = SOURCE_FILES.map((f) => fs.readFileSync(f, 'utf8'));

function isLoadBearer(_servicePath, exportName) {
  const pattern = new RegExp(`\\.\\s*${exportName}\\s*\\(`);
  return SOURCE_TEXT.some((src) => pattern.test(src));
}

function check() {
  const violations = [];
  const testDirs = ['src/__tests__', 'tests'];
  // Scope mode (quiet by default). Full-repo scanning finds ~2,600 HISTORICAL
  // mock-key gaps that tests pass despite (narrow mocks never hit on the
  // mocked path) — flagging those would train everyone to ignore the gate.
  // The drift that actually bites is NEW drift: a commit touches a service's
  // exports (or its route callers) while a test file mocking that module is
  // NOT co-changed. --staged checks only staged files (pre-commit / CI);
  // --full keeps the historical scan for manual audits.
  const mode = process.argv.includes('--full') ? 'full' : 'staged';
  let stagedServicePaths = null;
  let stagedTestPaths = null;
  if (mode === 'staged') {
    const git = (args) => {
      try { return require('child_process').execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim(); }
      catch { return ''; }
    };
    const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
    const head = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
    const all = new Set([...staged.split('\n'), ...head.split('\n')].filter(Boolean));
    const isTest = (f) => /demo_api_server\/(src\/__tests__|tests)\/.*\.test\.js$/.test(f);
    stagedServicePaths = [...all].filter((f) => /demo_api_server\/(routes|services|middleware)\/.*\.js$/.test(f));
    stagedTestPaths = [...all].filter(isTest);
    // If the commit itself edits a test file, skip flagging THAT test (it is
    // being updated right now); only flag committed test files untouched by
    // the commit whose mocked module IS touched.
    if (!stagedServicePaths.length && !stagedTestPaths.length) return violations;
  }
  for (const dir of testDirs) {
    const absDir = path.join(SRV, dir);
    if (!fs.existsSync(absDir)) continue;
    const stack = [absDir];
    while (stack.length) {
      const dirPath = stack.pop();
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const p = path.join(dirPath, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!entry.name.endsWith('.test.js')) continue;
        const rel = path.relative(REPO, p);
        if (mode === 'staged' && stagedTestPaths.includes(rel)) continue;
        const source = fs.readFileSync(p, 'utf8');
        for (const factory of extractJestMockFactories(source)) {
          const real = resolveModule(p, factory.module);
          if (!real) continue;
          // In staged mode, only care when the mocked module itself (or a
          // file that calls into it) changed in this commit.
          if (mode === 'staged') {
            const realRel = path.relative(REPO, real);
            const touchedDirect = stagedServicePaths.includes(realRel);
            const touchedCaller = stagedServicePaths.some((f) => {
              try { return fs.readFileSync(path.join(REPO, f), 'utf8').includes(path.basename(real, '.js')); }
              catch { return false; }
            });
            if (!touchedDirect && !touchedCaller) continue;
          }
          const exports = extractRealExports(real);
          if (!exports) continue;
          for (const name of exports) {
            if (factory.keys.includes(name)) continue;
            if (!isLoadBearer(real, name)) continue;
            violations.push({ test: rel, module: factory.module, missing: name });
          }
        }
      }
    }
  }
  return violations;
}

module.exports = { check, extractJestMockFactories, extractRealExports };

if (require.main === module) {
  const violations = check();
  if (violations.length) {
    console.error('✗ mock-drift gate FAILED — jest.mock factories missing load-bearing exports:\n');
    for (const v of violations) {
      console.error(`  ${v.test}\n    mock of "${v.module}" is missing "${v.missing}" — the route/service calls it. Add it to the jest.mock factory (e.g. ${v.missing}: jest.fn()).`);
    }
    console.error(`\n${violations.length} violation(s). Reference postmortem: ciba.test.js missing isLocalSimulationEnabled (2026-09-26).`);
    process.exit(1);
  }
  console.log('✓ mock-drift: no jest.mock factory is missing a load-bearing export.');
}
