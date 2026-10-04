const test = require('node:test');
const { after } = test;
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
  fs.mkdirSync(path.join(dir, 'demo_api_server/config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo_api_server/config/auth-requirements.json'), JSON.stringify({ useCases: { UC1: 'public', UC40: 'public' } }));
  git('add', 'pf/a.js', 'keep.js', 'run.sh', 'demo_api_server/config/auth-requirements.json'); git('commit', '-q', '-m', 'init');
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

test('writes demo_api_server/config/edition.json with dropUseCases for the BFF', () => {
  const d = dest();
  exportEdition({ manifest: mf({ dropUseCases: ['UC40'] }), ref: 'main', srcRepo: fixtureRepo(), dest: d });
  const e = JSON.parse(fs.readFileSync(path.join(d, 'demo_api_server/config/edition.json'), 'utf8'));
  assert.deepStrictEqual(e.dropUseCases, ['UC40']);
});

test('fails before writing anything when a dropUseCases id matches no use case', () => {
  const d = dest();
  assert.throws(() => exportEdition({ manifest: mf({ dropUseCases: ['UC4O'] }), ref: 'main', srcRepo: fixtureRepo(), dest: d }),
    /dropUseCases id "UC4O" matched no use case/);
  assert.ok(!fs.existsSync(d));
});

test('a manifest without dropUseCases writes an empty list', () => {
  const d = dest(); const m = mf(); delete m.dropUseCases;
  exportEdition({ manifest: m, ref: 'main', srcRepo: fixtureRepo(), dest: d });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, '.edition.json'), 'utf8')).dropUseCases, []);
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

const withForbidden = (v, fn) => {
  if (v === undefined) delete process.env.EDITION_FORBIDDEN_STRINGS; else process.env.EDITION_FORBIDDEN_STRINGS = v;
  try { fn(); } finally { delete process.env.EDITION_FORBIDDEN_STRINGS; }
};

test('forbidden-string gate fails closed when the list is unset or empty', () => {
  const d = tree({ 'a.js': '1' });
  for (const v of [undefined, '', ' , ']) {
    withForbidden(v, () => assert.throws(() => runGates(d, mf(), okRunner), /EDITION_FORBIDDEN_STRINGS not set/));
  }
});

test('forbidden-string scan covers build/, dist/ and symlink targets', () => {
  const d = tree({ 'build/x.txt': 'zz-needle-zz', 'dist/y.js': 'zz-needle-zz', 'ok.js': '1' });
  withForbidden('zz-needle-zz', () => assert.throws(() => runGates(d, mf(), okRunner), (e) => /build\/x\.txt/.test(e.message) && /dist\/y\.js/.test(e.message)));
  const l = tree({ 'ok.js': '1' });
  fs.symlinkSync('/somewhere/zz-needle-zz/target', path.join(l, 'link'));
  withForbidden('zz-needle-zz', () => assert.throws(() => runGates(l, mf(), okRunner), /link/));
});

test('gitleaks gate fails on a planted secret', () => {
  process.env.EDITION_FORBIDDEN_STRINGS = 'unused-placeholder-xyz';
  after(() => delete process.env.EDITION_FORBIDDEN_STRINGS);
  const d = tree({ 'k.js': 'const t = "ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5";\n' });
  assert.throws(() => runGates(d, mf(), okRunner), /gitleaks/);
});

// ---- gitleaks config (editions/gitleaks.toml) ----
const AUD = 'https://api.ping.demo:30' + '36/mcp/api' + 'key';
const gl = (d) => { process.env.EDITION_FORBIDDEN_STRINGS = 'unused-placeholder-xyz'; after(() => delete process.env.EDITION_FORBIDDEN_STRINGS); runGates(d, mf(), okRunner); };
const fakeToken = () => 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5';

test('gitleaks config: the allowlisted audience URI passes, a planted token beside it still fails', () => {
  const ok = tree({ 'scope.json': `{ "audience": "${AUD}" }\n`, 'doc.md': `| \`${AUD}\` |\n` });
  gl(ok);
  const bad = tree({ 'scope.json': `{ "audience": "${AUD}" }\n`, 'k.js': `const t = "${fakeToken()}";\n` });
  assert.throws(() => gl(bad), /gitleaks/);
});

test('gitleaks config: the URI with one extra character is not exempt', () => {
  // proves the allowlist is exact: without the config the default rule flags this line too
  const d = tree({ 'scope.json': `{ "audience": "${AUD}X" }\n` });
  assert.throws(() => gl(d), /gitleaks/);
});

// same-line secrets: the allowlists must exempt the finding, never the whole line
const GLEAN = '<img src="https://pingidentity-be.glean.com/api/v1/images?key=' + 'q8Zr3Kx9Lm2Vb7Nc4Td6Wy1Hj5Gf0SaXp7Rt2Uv9Be3Qk6Mn1Jc4Hd8Lf5Zs0Yw" />';

test('gitleaks config: a secret on the same line as the URI is still flagged', () => {
  gl(tree({ 'a.json': `{ "audience": "${AUD}" }\n` }));
  assert.throws(() => gl(tree({ 'a.json': `{ "audience": "${AUD}", "t": "${fakeToken()}" }\n` })), /gitleaks/);
  assert.throws(() => gl(tree({ 'a.env': `X=${AUD} API_` + 'KEY=' + require('node:crypto').randomBytes(18).toString('base64url') + '\n' })), /gitleaks/);
});

test('gitleaks config: a secret on the same line as an allowlisted Glean id is still flagged', () => {
  gl(tree({ 'ping_agent_guardrails_diagram.html': GLEAN + '\n' }));
  assert.throws(() => gl(tree({ 'ping_agent_guardrails_diagram.html': `${GLEAN} <!-- ${fakeToken()} -->\n` })), /gitleaks/);
  // the Glean exemption is per exact file: the same line elsewhere is flagged
  assert.throws(() => gl(tree({ 'other.html': GLEAN + '\n' })), /gitleaks/);
});

test('gitleaks config: a .gitleaks.toml in the exported tree fails the gate and cannot weaken it', () => {
  const d = tree({ 'k.js': `const t = "${fakeToken()}";\n`, 'sub/.gitleaks.toml': '[extend]\nuseDefault = false\n[[allowlists]]\nregexes = [\'\'\'.*\'\'\']\n' });
  assert.throws(() => gl(d), /gitleaks config in exported tree: sub\/\.gitleaks\.toml/);
});

test('gitleaks config: a shipped .gitleaksignore is inert (the finding still fails)', () => {
  const d = tree({ 'k.js': `const t = "${fakeToken()}";\n` });
  fs.writeFileSync(path.join(d, '.gitleaksignore'), 'k.js:github-pat:1\nk.js:generic-api-key:1\n');
  assert.throws(() => gl(d), /gitleaks/);
});

test('clean tree passes scan gates and runs build/test gates through the runner', () => {
  process.env.EDITION_FORBIDDEN_STRINGS = 'unused-placeholder-xyz';
  after(() => delete process.env.EDITION_FORBIDDEN_STRINGS);
  const d = tree({ 'a.js': 'module.exports = 1;', 'b.js': "require('./a');" });
  const calls = [];
  runGates(d, mf(), (cmd, args, opts) => calls.push(`${opts.cwd.replace(d, '.')}:${cmd} ${args.join(' ')}`));
  assert.strictEqual(calls.length, 5);
  assert.ok(calls.some((c) => /npm run authz:verify/.test(c)));
});

test('a failing runner step names its gate', () => {
  process.env.EDITION_FORBIDDEN_STRINGS = 'unused-placeholder-xyz';
  after(() => delete process.env.EDITION_FORBIDDEN_STRINGS);
  const d = tree({ 'a.js': '1' });
  assert.throws(() => runGates(d, mf(), () => { throw new Error('boom'); }), /gate failed: ui-build/);
});

test('relative-import gate: dangling fails naming the file, resolving passes', () => {
  const bad = tree({ 'src/a.js': "const x = require('./missing');", 'src/t.test.js': "jest.mock('../nope')" });
  assert.throws(() => checkRelativeImports(bad), (e) => /src\/a\.js/.test(e.message) && /src\/t\.test\.js/.test(e.message));
  const good = tree({ 'src/a.js': "import b from './b'; import('./d'); require('./c.json')", 'src/b.jsx': '', 'src/d/index.ts': '', 'src/c.json': '{}' });
  checkRelativeImports(good);
  // with a removed set, only imports of removed files are reported
  const mixed = tree({ 'a.js': "require('./gone'); require('./other');" });
  assert.throws(() => checkRelativeImports(mixed, new Set(['gone.js'])), (e) => /gone/.test(e.message) && !/other/.test(e.message));
  // a require inside try/catch is still reported (static scan, no control flow)
  const guarded = tree({ 'a.js': "try { require('./gone'); } catch (e) {}" });
  assert.throws(() => checkRelativeImports(guarded), /a\.js/);
});

test('removed-path gate: config referencing a removed path fails; docs and kept paths pass', () => {
  const { checkRemovedPathReferences } = require('./export-edition');
  const removed = new Set(['demo_api_server/routes/gone.js']);
  const dirs = ['scripts/pf/'];
  const bad = tree({ 'docker-compose.yml': 'volumes:\n  - ./scripts/pf/run.sh:/run.sh\n', 'k8s/a.yaml': 'x: demo_api_server/routes/gone.js', 'Dockerfile.x': 'COPY keep/a.js .', 'pkg/package.json': '{}' });
  assert.throws(() => checkRemovedPathReferences(bad, removed, dirs), (e) => /docker-compose\.yml/.test(e.message) && /k8s\/a\.yaml/.test(e.message) && !/Dockerfile/.test(e.message));
  const ok = tree({ 'docs/a.md': 'see demo_api_server/routes/gone.js and scripts/pf/', 'README.md': 'scripts/pf/', 'planning/x.sh': 'scripts/pf/', 'tests/y.sh': 'scripts/pf/', 'run.sh': 'node keep/a.js', 'Dockerfile.dockerignore': 'scripts/pf/x', 'docker-compose.yml': 'a: ./keep/', 'node_modules/p/package.json': 'scripts/pf/' });
  checkRemovedPathReferences(ok, removed, dirs);
  // basename alone does not match
  checkRemovedPathReferences(tree({ 'run.sh': 'node gone.js' }), removed, dirs);
});

test('regenerates the use-case docs before authz:verify when use cases are dropped', () => {
  process.env.EDITION_FORBIDDEN_STRINGS = 'unused-placeholder-xyz';
  after(() => delete process.env.EDITION_FORBIDDEN_STRINGS);
  const d = tree({ 'a.js': 'module.exports = 1;' });
  const calls = [];
  runGates(d, mf({ dropUseCases: ['UC40'] }), (cmd, args) => calls.push(`${cmd} ${args.join(' ')}`));
  assert.strictEqual(calls.length, 7);
  assert.ok(calls[0].includes('gen-use-cases-audit.js generate') && calls[1].includes('gen-use-cases-docs.js generate'));
});

// ---- export-time substitution ----
const { applySubstitutions } = require('./export-edition');
const UUID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'madeUpClientToken1234567890abcdef';
const thrown = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test('substitution: text rewritten, same value same placeholder, binary untouched, mode kept', () => {
  const d = tree({ 'a.env': `ENV=${UUID}\r\nX=${TOKEN}\r\n`, 'sub/b.md': `see ${UUID}`, 'ok.txt': 'nothing' });
  fs.writeFileSync(path.join(d, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(UUID)]));
  fs.writeFileSync(path.join(d, 'run.sh'), `#!/bin/sh\necho ${UUID}\n`, { mode: 0o755 });
  const binBefore = fs.readFileSync(path.join(d, 'bin.dat'));
  const r = applySubstitutions(d, [UUID, TOKEN]);
  assert.deepStrictEqual(r, { files: 3, byArea: { '.': 2, sub: 1 } });
  const a = fs.readFileSync(path.join(d, 'a.env'), 'utf8');
  assert.ok(!a.includes(UUID) && !a.includes(TOKEN) && a.includes('\r\n'));
  const ph = a.match(/ENV=(\S+)/)[1];
  assert.strictEqual(ph, '00000000-0000-4000-8000-000000000001');
  assert.ok(fs.readFileSync(path.join(d, 'sub/b.md'), 'utf8').includes(ph));
  assert.strictEqual(a.match(/X=(\S+)/)[1].length, TOKEN.length);
  assert.deepStrictEqual(fs.readFileSync(path.join(d, 'bin.dat')), binBefore);
  assert.ok(fs.statSync(path.join(d, 'run.sh')).mode & 0o100);
  assert.ok(!JSON.stringify(r).includes(UUID) && !JSON.stringify(r).includes(TOKEN));
  // the gate still scans binaries, so it sees the one left behind, and passes once it is gone
  withForbidden(`${UUID},${TOKEN}`, () => assert.throws(() => runGates(d, mf(), okRunner), /bin\.dat/));
  fs.unlinkSync(path.join(d, 'bin.dat'));
  withForbidden(`${UUID},${TOKEN}`, () => runGates(d, mf(), okRunner));
});

test('substitution: a value in a path or symlink target fails with the path only', () => {
  const d = tree({ [`dir-${TOKEN}/x.txt`]: '1' });
  const e1 = thrown(() => applySubstitutions(d, [TOKEN]));
  assert.ok(e1 && /forbidden string in path dir-/.test(e1.message) && !e1.message.includes(TOKEN));
  const l = tree({ 'ok.js': '1' });
  fs.symlinkSync(`/x/${UUID}/y`, path.join(l, 'link'));
  const e2 = thrown(() => applySubstitutions(l, [UUID]));
  assert.ok(e2 && /forbidden string in path link/.test(e2.message) && !e2.message.includes(UUID));
});

test('substitution: a too-short non-UUID value fails before any file is rewritten, without the value', () => {
  const SHORT = 'shortId-1234'; // 12 chars < len('EDITION-PLACEHOLDER-2')
  const d = tree({ 'a.txt': `${UUID} ${SHORT}` });
  const e = thrown(() => applySubstitutions(d, [UUID, SHORT]));
  assert.ok(e && /forbidden value #2 is too short/.test(e.message) && !e.message.includes(SHORT));
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), `${UUID} ${SHORT}`);
});

test('substitution: colliding placeholders fail by index', () => {
  const vals = Array.from({ length: 10 }, (_, i) => `v${i}-` + 'a'.repeat(20)); // 23 chars each
  vals[0] = 'EDITION-PLACEHOLDER-1'; // placeholder #1 equals value #1 itself
  const e = thrown(() => applySubstitutions(tree({ 'a.txt': '1' }), vals));
  assert.ok(e && /placeholder for forbidden value #1 contains forbidden value #1/.test(e.message));
  // same-length values whose truncated placeholders would merge are rejected as too short, never merged
  const e2 = thrown(() => applySubstitutions(tree({ 'a.txt': '1' }), ['abcdefghijklmnopqrst', 'abcdefghijklmnopqrsu', 'x'.repeat(8)]));
  assert.ok(e2 && /too short/.test(e2.message));
});

test('substitution: two long non-UUID values get distinct placeholders of their own length', () => {
  const A = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6', B = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4';
  const d = tree({ 'a.txt': `${A}|${B}` });
  applySubstitutions(d, [A, B]);
  const [x, y] = fs.readFileSync(path.join(d, 'a.txt'), 'utf8').split('|');
  assert.notStrictEqual(x, y);
  assert.strictEqual(x.length, A.length); assert.strictEqual(y.length, B.length);
});

test('substitution: a path failure leaves every file untouched', () => {
  const d = tree({ 'a.txt': TOKEN, [`z-${TOKEN}/x.txt`]: '1' });
  assert.ok(thrown(() => applySubstitutions(d, [TOKEN])));
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), TOKEN);
});

test('substitution: empty list is a no-op and the gate still fails closed', () => {
  const d = tree({ 'a.txt': UUID });
  assert.deepStrictEqual(applySubstitutions(d, []), { files: 0, byArea: {} });
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), UUID);
  withForbidden('', () => assert.throws(() => runGates(d, mf(), okRunner), /EDITION_FORBIDDEN_STRINGS not set/));
});
