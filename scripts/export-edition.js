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
  const keep = files.filter(({ file }) => !isRemoved(file));
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
  fs.writeFileSync(path.join(out, '.edition.json'),
    JSON.stringify({ name: manifest.name, provider: manifest.provider, sourceSha: sha, dropUseCases: manifest.dropUseCases }, null, 2) + '\n');
  return { copied: keep.length, removed: files.length - keep.length };
}

module.exports = { exportEdition };

if (require.main === module) {
  const [, , which, dest, ...rest] = process.argv;
  if (!['pingone', 'pingfederate'].includes(which) || !dest) {
    console.error('usage: export-edition.js <pingone|pingfederate> <dest> [--ref main]'); process.exit(2);
  }
  const ref = rest[rest.indexOf('--ref') + 1] || 'main';
  const repo = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'editions', `${which}.json`), 'utf8'));
  console.log(exportEdition({ manifest, ref, srcRepo: repo, dest }));
}
