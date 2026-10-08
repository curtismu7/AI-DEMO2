#!/usr/bin/env node
/* Generate an edition (P1-AI-DEMO / PF-AI-DEMO) from a git ref. See
 * docs/superpowers/specs/2026-10-03-edition-split-design.md.
 *
 * Exported editions carry PLACEHOLDER PingOne IDs: every value in EDITION_FORBIDDEN_STRINGS
 * (AI-DEMO2's own environment/client IDs) is replaced in the exported tree (fake UUIDs
 * 00000000-0000-4000-8000-0000000000NN, or EDITION-PLACEHOLDER-N at the original length), then the
 * forbidden-string gate proves none are left. An edition's real environment ID and client IDs come
 * from its own .env, produced by its own PingOne bootstrap - never from this repo. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, maxBuffer: 1 << 28 });

// Drift protection for the PingOne edition: every PF-named tracked file must be removed by the
// manifest or listed in `keep` (grouped, with a reason), so a PF file main adds later cannot ship
// silently. `keepIgnore` ({regex, reason}) exempts whole path classes (docs). The PF edition keeps
// all PF files, so it is not checked. ponytail: name heuristic only - a PF file with no PF-looking
// name is invisible here; the import/reference gates remain the backstop.
const PF_NAMED_RE = /pingfed|(^|\/)pf[-_A-Z]|\/pf-|-pf\/|PingFederate/i;
function checkManifestCoverage(manifest, trackedFiles, removedSet) {
  if (manifest.provider !== 'pingone') return;
  const tracked = new Set(trackedFiles);
  const kept = new Set();
  const stale = [], both = [];
  for (const g of manifest.keep || []) for (const p of g.paths) {
    kept.add(p);
    if (!tracked.has(p)) stale.push(p);
    if (removedSet.has(p)) both.push(p);
  }
  const ignore = (manifest.keepIgnore || []).map((i) => new RegExp(i.regex));
  const missing = trackedFiles.filter((f) => PF_NAMED_RE.test(f) && !removedSet.has(f) && !kept.has(f) && !ignore.some((r) => r.test(f)));
  const msg = [
    missing.length && `PF-named file(s) neither removed nor in keep (add to remove, or to keep with a reason):\n${missing.join('\n')}`,
    stale.length && `stale keep path(s), not in the ref:\n${stale.join('\n')}`,
    both.length && `path(s) in both keep and remove:\n${both.join('\n')}`,
  ].filter(Boolean);
  if (msg.length) throw new Error(`gate failed: manifest-coverage\n${msg.join('\n')}`);
}

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

  const drop = manifest.dropUseCases || [];
  if (drop.length) {
    const known = Object.keys(JSON.parse(git(src, 'show', `${sha}:demo_api_server/config/auth-requirements.json`)).useCases);
    for (const id of drop) if (!known.includes(id)) throw new Error(`dropUseCases id "${id}" matched no use case`);
  }

  const used = new Set();
  const isRemoved = (f) => manifest.remove.some((p) => {
    const hit = p.endsWith('/') ? f.startsWith(p) : f === p;
    if (hit) used.add(p);
    return hit;
  });
  const removedFiles = new Set();
  const keep = files.filter(({ file }) => { const r = isRemoved(file); if (r) removedFiles.add(file); return !r; });
  for (const p of manifest.remove) if (!used.has(p)) throw new Error(`remove pattern "${p}" matched nothing`);
  checkManifestCoverage(manifest, files.map((f) => f.file), removedFiles);

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
  const edition = JSON.stringify({ name: manifest.name, provider: manifest.provider, sourceSha: sha, dropUseCases: drop }, null, 2) + '\n';
  fs.writeFileSync(path.join(out, '.edition.json'), edition);
  // the BFF reads this copy (demo_api_server/config is visible natively, bind-mounted and in the image)
  fs.mkdirSync(path.join(out, 'demo_api_server/config'), { recursive: true });
  fs.writeFileSync(path.join(out, 'demo_api_server/config/edition.json'), edition);
  stampIdentity(out, manifest, sha);
  return { copied: keep.length, removed: removedFiles.size, removedFiles };
}

// An edition still carries AI-DEMO2's README/CLAUDE.md text. Prepend a banner
// naming the edition and the source sha so nobody mistakes it for the source
// repo or hand-edits it (spec: README/CLAUDE.md identity).
function stampIdentity(out, manifest, sha) {
  const banner = `<!-- GENERATED by scripts/export-edition.js from AI-DEMO2 @ ${sha}\n`
    + `     This is ${manifest.name} (${manifest.repo}, provider: ${manifest.provider}).\n`
    + `     Do not edit - changes are overwritten by the next re-export; edit AI-DEMO2 and re-export instead. -->\n\n`;
  for (const f of ['README.md', 'CLAUDE.md']) {
    const p = path.join(out, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (text.startsWith('<!-- GENERATED by scripts/export-edition.js')) continue; // idempotent
    fs.writeFileSync(p, banner + text);
  }
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

const forbiddenList = () => (process.env.EDITION_FORBIDDEN_STRINGS || '').split(',').map((s) => s.trim()).filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stable fake for forbidden value i; a UUID stays UUID-shaped, anything else keeps its length.
function placeholderFor(value, i) {
  const n = i + 1;
  if (UUID_RE.test(value)) return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const fill = /^[^a-z]*[A-Z]/.test(value) && !/[a-z]/.test(value) ? 'X' : /^\d+$/.test(value) ? '0' : 'x';
  return `EDITION-PLACEHOLDER-${n}`.padEnd(value.length, fill).slice(0, value.length);
}

// Replace each forbidden value with its placeholder in the content of every text file under dest.
// Output (return value, errors) never contains a value: counts and paths only.
function applySubstitutions(dest, values) {
  // validate before touching anything; messages name the list index only, never a value
  const phs = values.map((v, i) => {
    const min = `EDITION-PLACEHOLDER-${i + 1}`.length;
    if (!UUID_RE.test(v) && v.length < min) throw new Error(`forbidden value #${i + 1} is too short to substitute safely (needs at least ${min} characters)`);
    return placeholderFor(v, i);
  });
  phs.forEach((ph, i) => {
    if (phs.indexOf(ph) !== i) throw new Error(`placeholder for forbidden value #${i + 1} collides with an earlier placeholder`);
    const k = values.findIndex((v) => ph.includes(v));
    if (k >= 0) throw new Error(`placeholder for forbidden value #${i + 1} contains forbidden value #${k + 1}`);
  });
  const pairs = values.map((v, i) => [Buffer.from(v).toString('latin1'), phs[i]])
    .sort((a, b) => b[0].length - a[0].length); // longest first: a value that contains another is replaced whole
  const result = { files: 0, byArea: {} };
  if (!pairs.length) return result;
  const hasValue = (s) => pairs.some(([v]) => s.includes(v));
  // the path itself would carry the value, so the error shows it with placeholders applied
  const redact = (s) => pairs.reduce((t, [v, ph]) => t.split(v).join(ph), s);
  const badPath = (rel) => new Error(`gate failed: forbidden string in path ${redact(rel)}`);
  // pass 1: path/symlink check over the whole tree, so a path failure leaves every file untouched
  const files = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(dest, p);
      if (hasValue(Buffer.from(e.name).toString('latin1'))) throw badPath(rel);
      if (e.isSymbolicLink()) {
        if (hasValue(Buffer.from(fs.readlinkSync(p)).toString('latin1'))) throw badPath(rel);
        continue;
      }
      if (e.isDirectory()) scan(p); else files.push([p, rel]);
    }
  };
  scan(dest);
  for (const [p, rel] of files) {
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 8192).includes(0)) continue;
    // latin1 round-trips every byte, so a literal split/join never alters unrelated content
    const text = buf.toString('latin1');
    let out = text;
    for (const [v, ph] of pairs) out = out.split(v).join(ph);
    if (out === text) continue;
    fs.writeFileSync(p, Buffer.from(out, 'latin1')); // rewrite in place: mode is kept
    result.files++;
    const area = rel.includes(path.sep) ? rel.split(path.sep)[0] : '.';
    result.byArea[area] = (result.byArea[area] || 0) + 1;
  }
  return result;
}

function checkForbidden(dest) {
  const list = forbiddenList();
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

const GITLEAKS_CONFIG = path.resolve(__dirname, '..', 'editions', 'gitleaks.toml');

// a config file shipped in the exported tree could be mistaken for the gate's config
// (.gitleaksignore is inert under --no-git and ships as-is, so it is not flagged).
// Only names gitleaks could auto-load are flagged: dot-prefixed at any depth, plain at the tree root.
// A plain gitleaks.toml in a subdirectory (editions/gitleaks.toml, the export tooling's own config) is inert.
function checkNoGitleaksConfig(dest) {
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/^\.gitleaks\.(toml|ya?ml)$/.test(e.name) || (dir === dest && /^gitleaks\.(toml|ya?ml)$/.test(e.name))) hits.push(path.relative(dest, p));
    }
  };
  scan(dest);
  if (hits.length) throw new Error(`gate failed: gitleaks config in exported tree: ${hits.join(', ')}`);
}

const JEST_SCOPE = ['tests/crossVerticalIntentGuard.test.js', 'src/__tests__/featureFlags.route.test.js', 'src/__tests__/authorize-gate.test.js'];

function runGates(dest, manifest, runner = defaultRunner, removed) {
  checkForbidden(dest);
  checkRelativeImports(dest, removed);
  checkRemovedPathReferences(dest, removed, manifest.remove);
  checkNoGitleaksConfig(dest);
  try {
    // config comes from the source repo (__dirname), never from the exported tree
    // clean env: an inherited GITLEAKS_* variable (e.g. GITLEAKS_CONFIG) must never matter
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GITLEAKS_')));
    execFileSync('gitleaks', ['detect', '--no-git', '--source', dest, '--no-banner', '--config', GITLEAKS_CONFIG], { stdio: 'pipe', env });
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

module.exports = { checkNoGitleaksConfig, exportEdition, checkManifestCoverage,runGates, applySubstitutions, forbiddenList, checkRelativeImports, checkRemovedPathReferences };

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
  // placeholders go in before the forbidden-string scan, so the scan proves nothing was left
  const subs = forbiddenList().length ? applySubstitutions(path.resolve(dest), forbiddenList()) : { files: 0, byArea: {} };
  console.log(`substituted placeholder IDs in ${subs.files} file(s):`, subs.byArea);
  runGates(path.resolve(dest), manifest, undefined, removedFiles);
  console.log('all gates passed');
}
