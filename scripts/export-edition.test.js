const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { exportEdition } = require('./export-edition');

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edition-src-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'pf'));
  fs.writeFileSync(path.join(dir, 'pf/a.js'), 'pf');
  fs.writeFileSync(path.join(dir, 'keep.js'), 'keep');
  fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  git('add', 'pf/a.js', 'keep.js', 'run.sh'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1'); // untracked
  return dir;
}
const mf = (over = {}) => ({ name: 'x', repo: 'X', provider: 'pingone', remove: ['pf/'], dropUseCases: [], ...over });
const dest = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edition-out-')), 'out');

test('copies tracked files, drops removed dir, never copies untracked .env', () => {
  const src = fixtureRepo(), d = dest();
  exportEdition({ manifest: mf(), ref: 'main', srcRepo: src, dest: d });
  assert.ok(fs.existsSync(path.join(d, 'keep.js')));
  assert.ok(!fs.existsSync(path.join(d, 'pf/a.js')));
  assert.ok(!fs.existsSync(path.join(d, '.env')));
});

test('fails when a remove pattern matches nothing', () => {
  assert.throws(() => exportEdition({ manifest: mf({ remove: ['nope/'] }), ref: 'main', srcRepo: fixtureRepo(), dest: dest() }), /matched nothing/);
});

test('refuses a dest inside the source repo and a non-empty dest', () => {
  const src = fixtureRepo();
  assert.throws(() => exportEdition({ manifest: mf(), ref: 'main', srcRepo: src, dest: path.join(src, 'out') }), /inside the source/);
  const d = dest(); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'x'), '1');
  assert.throws(() => exportEdition({ manifest: mf(), ref: 'main', srcRepo: src, dest: d }), /not empty/);
});

test('writes .edition.json with provider and source sha', () => {
  const src = fixtureRepo(), d = dest();
  exportEdition({ manifest: mf({ provider: 'pingfederate' }), ref: 'main', srcRepo: src, dest: d });
  const e = JSON.parse(fs.readFileSync(path.join(d, '.edition.json'), 'utf8'));
  assert.strictEqual(e.provider, 'pingfederate');
  assert.match(e.sourceSha, /^[0-9a-f]{40}$/);
});

test('accepts an empty remove list', () => {
  const d = dest();
  exportEdition({ manifest: mf({ remove: [] }), ref: 'main', srcRepo: fixtureRepo(), dest: d });
  assert.ok(fs.existsSync(path.join(d, 'pf/a.js')));
});

test('a tracked executable file stays executable', () => {
  const d = dest();
  exportEdition({ manifest: mf(), ref: 'main', srcRepo: fixtureRepo(), dest: d });
  assert.ok(fs.statSync(path.join(d, 'run.sh')).mode & 0o100);
});

// ---- gates ----
const { runGates, checkRelativeImports } = require('./export-edition');
const tree = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'edition-gate-'));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  return d;
};
const okRunner = () => {};

test('forbidden-string gate fails without printing the string', () => {
  const d = tree({ 'a.js': 'const x = "abc-secret-env-id";' });
  process.env.EDITION_FORBIDDEN_STRINGS = 'abc-secret-env-id';
  try {
    assert.throws(() => runGates(d, mf(), okRunner), (e) => /forbidden string/.test(e.message) && /a\.js/.test(e.message) && !e.message.includes('abc-secret-env-id'));
  } finally { delete process.env.EDITION_FORBIDDEN_STRINGS; }
});

test('gitleaks gate fails on a planted secret', () => {
  const d = tree({ 'k.js': 'const t = "ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5";\n' });
  assert.throws(() => runGates(d, mf(), okRunner), /gitleaks/);
});

test('clean tree passes scan gates and runs build/test gates through the runner', () => {
  const d = tree({ 'a.js': 'module.exports = 1;', 'b.js': "require('./a');" });
  const calls = [];
  runGates(d, mf(), (cmd, args, opts) => calls.push(`${opts.cwd.replace(d, '.')}:${cmd} ${args.join(' ')}`));
  assert.strictEqual(calls.length, 4);
  assert.ok(calls.some((c) => /npm run authz:verify/.test(c)));
});

test('a failing runner step names its gate', () => {
  const d = tree({ 'a.js': '1' });
  assert.throws(() => runGates(d, mf(), () => { throw new Error('boom'); }), /gate failed: ui-build/);
});

test('relative-import gate: dangling fails naming the file, resolving passes', () => {
  const bad = tree({ 'src/a.js': "const x = require('./missing');", 'src/t.test.js': "jest.mock('../nope')" });
  assert.throws(() => checkRelativeImports(bad), (e) => /src\/a\.js/.test(e.message) && /src\/t\.test\.js/.test(e.message));
  const good = tree({ 'src/a.js': "import b from './b'; import('./d'); require('./c.json')", 'src/b.jsx': '', 'src/d/index.ts': '', 'src/c.json': '{}' });
  checkRelativeImports(good);
  // a require inside try/catch is still reported (static scan, no control flow)
  const guarded = tree({ 'a.js': "try { require('./gone'); } catch (e) {}" });
  assert.throws(() => checkRelativeImports(guarded), /a\.js/);
});
