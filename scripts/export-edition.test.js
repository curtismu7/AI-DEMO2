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
