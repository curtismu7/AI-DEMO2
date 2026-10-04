#!/usr/bin/env node
/* Generate an edition (P1-AI-DEMO / PF-AI-DEMO) from a git ref. See
 * docs/superpowers/specs/2026-10-03-edition-split-design.md. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, maxBuffer: 1 << 28 });

function exportEdition({ manifest, ref, srcRepo, dest }) {
  const src = fs.realpathSync(srcRepo);
  // realpath the nearest existing ancestor so /var vs /private/var (macOS) compare equal
  const resolved = path.resolve(dest);
  let anc = resolved; const tail = [];
  while (!fs.existsSync(anc)) { tail.unshift(path.basename(anc)); anc = path.dirname(anc); }
  const out = path.join(fs.realpathSync(anc), ...tail);
  if (out === src || out.startsWith(src + path.sep)) throw new Error(`dest ${out} is inside the source repo`);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`dest ${out} is not empty`);

  const sha = git(src, 'rev-parse', ref).toString().trim();
  // entries: "<mode> <type> <sha>\t<path>"
  const files = git(src, 'ls-tree', '-r', '-z', sha).toString().split('\0').filter(Boolean).map((e) => {
    const tab = e.indexOf('\t');
    return { mode: e.slice(0, e.indexOf(' ')), file: e.slice(tab + 1) };
  });

  const used = new Set();
  const isRemoved = (f) => manifest.remove.some((p) => {
    const hit = p.endsWith('/') ? f.startsWith(p) : f === p;
    if (hit) used.add(p);
    return hit;
  });
  const removedFiles = new Set();
  const keep = files.filter(({ file }) => { const r = isRemoved(file); if (r) removedFiles.add(file); return !r; });
  for (const p of manifest.remove) if (!used.has(p)) throw new Error(`remove pattern "${p}" matched nothing`);

  for (const { mode, file } of keep) {
    const to = path.join(out, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const blob = git(src, 'show', `${sha}:${file}`);
    if (mode === '120000') fs.symlinkSync(blob.toString(), to);
    else {
      fs.writeFileSync(to, blob);
      if (mode === '100755') fs.chmodSync(to, 0o755);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  const edition = JSON.stringify({ name: manifest.name, provider: manifest.provider, sourceSha: sha, dropUseCases: manifest.dropUseCases }, null, 2) + '\n';
  fs.writeFileSync(path.join(out, '.edition.json'), edition);
  // the BFF reads this copy (demo_api_server/config is visible natively, bind-mounted and in the image)
  fs.mkdirSync(path.join(out, 'demo_api_server/config'), { recursive: true });
  fs.writeFileSync(path.join(out, 'demo_api_server/config/edition.json'), edition);
  return { copied: keep.length, removed: removedFiles.size, removedFiles };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, fn); } else fn(p);
  }
}

const SRC_RE = /\.(js|cjs|mjs|jsx|ts|tsx)$/;
const IMPORT_RES = [
  /\b(?:require|import|jest\.mock|jest\.requireActual)\s*\(\s*['"](\.{1,2}(?:\/[^'"]*)?)['"]/g,
  /\b(?:from|import)\s+['"](\.{1,2}(?:\/[^'"]*)?)['"]/g,
];
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.cjs', '.mjs'];
const resolves = (base) => EXTS.some((x) => fs.existsSync(base + x) && fs.statSync(base + x).isFile())
  || EXTS.slice(1).some((x) => fs.existsSync(path.join(base, 'index' + x)));

// ponytail: purely static text scan - a require inside try/catch is still reported, and a
// specifier in a comment is a false positive. Upgrade to an AST walk if either bites.
// removed (optional Set of dest-relative paths the export dropped): when given, report only
// unresolved specifiers that point at one of them, so pre-existing dangling imports in the
// source (archived docs, `.js`-for-`.ts` specifiers, `?raw`) don't drown the signal.
const candidates = (base) => [...EXTS.map((x) => base + x), ...EXTS.slice(1).map((x) => path.join(base, 'index' + x))];
function checkRelativeImports(dest, removed) {
  const bad = [];
  walk(dest, (f) => {
    if (!SRC_RE.test(f)) return;
    const text = fs.readFileSync(f, 'utf8').replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of IMPORT_RES) for (const m of text.matchAll(re)) {
      const target = path.resolve(path.dirname(f), m[1]);
      if (resolves(target)) continue;
      if (!removed || candidates(target).some((c) => removed.has(path.relative(dest, c)))) bad.push(`${path.relative(dest, f)} -> ${m[1]}`);
    }
  });
  if (bad.length) throw new Error(`gate failed: relative-imports (${bad.length} unresolved)\n${[...new Set(bad)].join('\n')}`);
}

// Retained non-JS config (compose, k8s, workflows, Dockerfiles, py, sh, package.json) must not
// name a removed file or removed directory by its full repo-relative path. Docs/planning/tests skipped.
const CONFIG_RE = /(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile[^/]*|package\.json|[^/]+\.(py|sh))$|^(k8s|\.github\/workflows)\/.*\.ya?ml$/;
const NOT_CONFIG_RE = /^(docs|planning)\/|(^|\/)(tests?|__tests__)\/|\.test\.|\.spec\.|\.dockerignore$/;
function checkRemovedPathReferences(dest, removed, remove = []) {
  if (!removed) return;
  const needles = [...removed, ...remove.filter((r) => r.endsWith('/'))];
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      const rel = path.relative(dest, p);
      if (!CONFIG_RE.test(rel) || NOT_CONFIG_RE.test(rel)) continue;
      const text = fs.readFileSync(p).toString('latin1');
      if (needles.some((n) => text.includes(n))) hits.push(rel);
    }
  };
  scan(dest);
  if (hits.length) throw new Error(`gate failed: removed-path-references (${hits.length} file(s))\n${hits.join('\n')}`);
}

function checkForbidden(dest) {
  const list = (process.env.EDITION_FORBIDDEN_STRINGS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('gate failed: EDITION_FORBIDDEN_STRINGS not set');
  const needles = list.map((s) => Buffer.from(s));
  const hits = [];
  // scan every tracked path: skip only .git; a symlink is checked by its target text, not followed
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      const buf = e.isSymbolicLink() ? Buffer.from(fs.readlinkSync(p)) : fs.readFileSync(p);
      if (needles.some((n) => buf.includes(n))) hits.push(path.relative(dest, p));
    }
  };
  scan(dest);
  // never print the matched string - paths and count only
  if (hits.length) throw new Error(`gate failed: forbidden string found in ${hits.length} file(s)\n${hits.join('\n')}`);
}

const LOG_DIR = () => process.env.EDITION_GATE_LOG_DIR || require('node:os').tmpdir();
// default runner: output to a log file, exit code checked directly
function defaultRunner(cmd, args, opts) {
  const log = path.join(LOG_DIR(), `edition-gate-${opts.name}.log`);
  const fd = fs.openSync(log, 'a');
  try {
    execFileSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', fd, fd] });
  } catch (e) { throw new Error(`${e.message.split('\n')[0]} (see ${log})`); } finally { fs.closeSync(fd); }
}

const JEST_SCOPE = ['tests/crossVerticalIntentGuard.test.js', 'src/__tests__/featureFlags.route.test.js', 'src/__tests__/authorize-gate.test.js'];

function runGates(dest, manifest, runner = defaultRunner, removed) {
  checkForbidden(dest);
  checkRelativeImports(dest, removed);
  checkRemovedPathReferences(dest, removed, manifest.remove);
  try {
    execFileSync('gitleaks', ['detect', '--no-git', '--source', dest, '--no-banner'], { stdio: 'pipe' });
  } catch (e) { throw new Error(`gate failed: gitleaks (${e.status === 1 ? 'leaks found' : e.message.split('\n')[0]})`); }
  // generated use-case docs list every use case; regenerate so they match the dropped set
  const regen = (manifest.dropUseCases || []).length
    ? ['gen-use-cases-audit.js', 'gen-use-cases-docs.js'].map((g) => ['regen-docs', 'node', [`../scripts/${g}`, 'generate'], 'demo_api_server', {}])
    : [];
  const steps = [
    ...regen,
    ['ui-build', 'npm', ['ci'], 'demo_api_ui', {}],
    ['ui-build', 'npm', ['run', 'build'], 'demo_api_ui', {}],
    ['bff-jest', 'npm', ['ci'], 'demo_api_server', {}],
    ['bff-jest', 'npx', ['jest', ...JEST_SCOPE, '--forceExit'], 'demo_api_server', { CI: 'true' }],
    ['authz-verify', 'npm', ['run', 'authz:verify'], '.', {}],
  ];
  for (const [name, cmd, args, sub, env] of steps) {
    try { runner(cmd, args, { cwd: path.join(dest, sub), env, name }); } catch (e) { throw new Error(`gate failed: ${name}: ${e.message}`); }
  }
}

module.exports = { exportEdition, runGates, checkRelativeImports, checkRemovedPathReferences };

if (require.main === module) {
  const [, , which, dest, ...rest] = process.argv;
  if (!['pingone', 'pingfederate'].includes(which) || !dest) {
    console.error('usage: export-edition.js <pingone|pingfederate> <dest> [--ref main]'); process.exit(2);
  }
  const ref = rest[rest.indexOf('--ref') + 1] || 'main';
  const repo = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'editions', `${which}.json`), 'utf8'));
  const { removedFiles, ...summary } = exportEdition({ manifest, ref, srcRepo: repo, dest });
  console.log(summary);
  runGates(path.resolve(dest), manifest, undefined, removedFiles);
  console.log('all gates passed');
}
