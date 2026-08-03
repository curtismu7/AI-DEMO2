'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Step 0a — Node version pre-flight
// Catch the common "ran in a shell where nvm isn't loaded" case before sqlite/tar
// errors mask the root cause. Reads required major from root package.json#engines.node.
function checkNodeVersion() {
  // Accept any Node major at or above engines.node's floor (e.g. ">=20", "20.x").
  const ROOT_PKG = path.resolve(__dirname, '..', '..', 'package.json');
  let floor = 20;
  try {
    const engines = JSON.parse(fs.readFileSync(ROOT_PKG, 'utf8')).engines;
    const m = engines && engines.node && String(engines.node).match(/(\d+)/);
    if (m) floor = parseInt(m[1], 10);
  } catch (_e) { /* fall back to 20 */ }

  const actual = parseInt(String(process.versions.node || '').split('.')[0], 10);
  if (Number.isFinite(actual) && actual >= floor) return;

  console.error(`Node ${floor}+ required, but this shell is using Node ${process.version}.`);
  console.error('');
  console.error(`Fix (zsh/bash) — load nvm into THIS shell, then switch to Node ${floor} or newer:`);
  console.error('  export NVM_DIR="$HOME/.nvm"');
  console.error('  [ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"');
  console.error(`  nvm install ${floor} && nvm use ${floor}`);
  console.error('');
  console.error('Persist for future shells: add the two export/source lines above to');
  console.error('  ~/.zshrc (zsh)   or   ~/.bashrc (bash)');
  console.error('');
  console.error('No nvm yet? Install: https://github.com/nvm-sh/nvm#installing-and-updating');
  console.error('');
  console.error('Then re-run this command from the AI-demo repo.');
  process.exit(1);
}
checkNodeVersion();

// Step 0b — package pre-flight
let tar;
try {
  tar = require('tar');
} catch (_e) {
  console.error('Required package "tar" is not installed.');
  console.error('Run:  cd demo_api_server && npm install');
  console.error('Then retry the export.');
  process.exit(1);
}

// NO SQLITE — the persistent store is LMDB (data/persistent/lmdb/), which the
// directory walk below bundles like any other file. No .db driver / probe.

console.log('Package pre-flight passed');

const http = require('http');

// Paths — script lives in scripts/, server root is one level up
const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const DATA_PERSISTENT = path.join(SERVER_ROOT, 'data', 'persistent');
const ENV_FILE = path.join(SERVER_ROOT, '.env');

// Seed/config JSON that lives in the repo (not under data/persistent/) and is
// the source-of-truth for topology, scopes, agent directives, and verticals.
// These are git-tracked, so a clean clone already has them — but an operator may
// edit them locally. Bundling a copy makes a snapshot self-contained for
// disaster recovery. They are restored to data/persistent/seed-snapshot/ on
// import (NOT over the live files) so this never inverts the file-is-SoT model.
function collectSeedFiles() {
  const out = []; // { src, name } where name is the archive path under 'seed/'
  const singles = [
    path.join(REPO_ROOT, 'service-topology.json'),
    path.join(REPO_ROOT, 'scope-topology.json'),
    path.join(REPO_ROOT, 'LLM.json'),
    path.join(REPO_ROOT, 'docs', 'HELIX_AGENT_DIRECTIVES.json'),
  ];
  for (const abs of singles) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      out.push({ src: abs, name: path.posix.join('seed', path.relative(REPO_ROOT, abs).split(path.sep).join('/')) });
    }
  }
  // Vertical config JSON (manifest.json / mock-data.json) — skip index.js (code).
  const verticalsDir = path.join(SERVER_ROOT, 'config', 'verticals');
  if (fs.existsSync(verticalsDir)) {
    for (const id of fs.readdirSync(verticalsDir)) {
      const dir = path.join(verticalsDir, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const abs = path.join(dir, f);
        out.push({ src: abs, name: path.posix.join('seed', path.relative(REPO_ROOT, abs).split(path.sep).join('/')) });
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Forward-compat: walk data/persistent/ and bundle every regular file except
// the documented skip-list. Older versions of this script used a hard-coded
// allow-list (DB_FILES + JSON_FILES) which silently dropped any new persistent
// file a service later added — e.g. agentIdentityMappings.json. The deny-list
// approach below picks up new state automatically; if a future file genuinely
// shouldn't migrate (machine-bound, ephemeral), add it to SKIP_PERSISTENT.
//
// Anything machine-bound (sessions, host-specific TLS, transient probe state)
// or rebuilt at runtime from authoritative sources lives here:
const SKIP_PERSISTENT = new Set([
  // Legacy SQLite artifacts — no longer produced (store is LMDB), kept so an
  // old data/persistent/ dir still exports cleanly.
  'sessions.db',
  'sessions.db-journal',
  'sessions.db-wal',
  'sessions.db-shm',
  'lock.mdb',                       // LMDB lock file — machine-bound, regenerated on open
  'runtimeData.json',               // ephemeral snapshot rebuilt from the store
  'runtimeData.json.bak',
  'manifest-last-import.json',      // breadcrumb from last import; not data
]);

// Skip these even if they sneak into data/persistent/. Backups belong in
// data/backups/ (excluded by directory walk), but if anything weird ever
// appears here we want to filter it deterministically.
const SKIP_PREFIXES = ['runtimeData-'];   // dated runtimeData backups
const SKIP_SUFFIXES = ['.tmp', '.lock'];  // half-written / lock files

// Step 1 — resolve output path
function resolveOutputPath() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  if (outIdx !== -1 && args[outIdx + 1]) {
    return path.resolve(args[outIdx + 1]);
  }
  if (process.env.BANKING_EXPORT_PATH) {
    return path.resolve(process.env.BANKING_EXPORT_PATH);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19) + 'Z';
  return path.resolve(process.cwd(), `banking-export-${ts}.tar.gz`);
}

const outputPath = resolveOutputPath();
const outputDir = path.dirname(outputPath);

if (!fs.existsSync(outputDir)) {
  console.error(`Output directory does not exist: ${outputDir}`);
  process.exit(1);
}

try {
  fs.accessSync(outputDir, fs.constants.W_OK);
} catch (_eAccess) {
  console.error(`Output directory is not writable: ${outputDir}`);
  process.exit(1);
}

// Step 2 — check server status
function checkServer() {
  return new Promise((resolve) => {
    const port = process.env.PORT || 3001;
    const req = http.request({ hostname: 'localhost', port, path: '/api/health/live', method: 'GET', timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200 ? 'up' : 'down');
    });
    req.on('error', () => resolve('down'));
    req.on('timeout', () => { req.destroy(); resolve('down'); });
    req.end();
  });
}

async function main() {
  const serverStatus = await checkServer();
  if (serverStatus === 'up') {
    // LMDB is multi-process safe; bundling data/persistent/ while the server
    // runs is fine (the .mdb file is copied as-is). Warn so the operator knows
    // the snapshot is point-in-time.
    console.log('Server is running — bundling the LMDB store as a point-in-time snapshot');
  } else {
    console.log('Server is stopped — bundling the LMDB store');
  }

  // Step 3 — discover everything in data/persistent/ (deny-list approach).
  //
  // Walk the directory and bundle every regular file the deny-list doesn't
  // exclude. .db files get an open/close probe (when better-sqlite3 is
  // available) so corrupt databases are surfaced early instead of bundled
  // silently. Subdirectories are walked recursively so future services can
  // namespace their state under data/persistent/<service>/.
  const includedFiles = [];   // archive paths, e.g. 'persistent/config.db'
  const skipped = [];         // human-readable reasons for the manifest

  function shouldSkip(name) {
    if (SKIP_PERSISTENT.has(name)) return 'machine-bound or ephemeral';
    if (SKIP_PREFIXES.some(p => name.startsWith(p))) return 'matches skip prefix';
    if (SKIP_SUFFIXES.some(s => name.endsWith(s)))   return 'matches skip suffix';
    return null;
  }

  function walk(absDir, archiveDir) {
    if (!fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const archiveName = path.posix.join(archiveDir, entry.name);

      if (entry.isDirectory()) {
        walk(abs, archiveName);
        continue;
      }
      if (!entry.isFile()) continue;            // skip symlinks, sockets, fifos

      const skipReason = shouldSkip(entry.name);
      if (skipReason) {
        skipped.push(`${archiveName} — ${skipReason}`);
        continue;
      }

      includedFiles.push(archiveName);
    }
  }

  walk(DATA_PERSISTENT, 'persistent');

  // Stable order so reruns produce identical manifests when content matches.
  includedFiles.sort();

  // Step 4 — collect .env
  const hasEnv = fs.existsSync(ENV_FILE);
  if (!hasEnv) {
    console.warn('');
    console.warn('WARNING: No .env file found — archive will not include environment variables.');
    console.warn('         The app will not start on the destination without a .env file.');
    console.warn('');
  }

  // Step 4b — collect repo seed/config files (best-effort; existing only)
  const seedEntries = collectSeedFiles();
  const seedNames = seedEntries.map(e => e.name);

  // Step 5 — build manifest
  const allFiles = [...(hasEnv ? ['.env'] : []), ...includedFiles, ...seedNames];

  const manifest = {
    version: 2,
    exportedAt: new Date().toISOString(),
    sourceNodeVersion: process.version,
    sourcePlatform: process.platform,
    files: allFiles,
    hasEnv,
    skipped: [
      'sessions.db — machine-bound Express sessions',
      'runtimeData.json — ephemeral in-memory snapshot',
      'certs/ — machine-bound TLS certificates (regenerate with mkcert on destination)',
      ...skipped,
    ],
  };

  // Step 6 — create archive
  const tempPath = outputPath + '.tmp.' + process.pid;

  // Build list of entries: { src, archiveName }. archiveName already starts
  // with 'persistent/' from the walk; map it back to an absolute source path.
  const entries = includedFiles.map(archiveName => ({
    src: path.join(DATA_PERSISTENT, archiveName.slice('persistent/'.length)),
    name: archiveName,
  }));
  if (hasEnv) {
    entries.push({ src: ENV_FILE, name: '.env' });
  }
  // Seed/config files (archive name already starts with 'seed/').
  entries.push(...seedEntries);

  // Write all files into a staging dir so tar can pack them
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-export-'));

  try {
    // Write manifest
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Copy each file into staging tree
    for (const entry of entries) {
      const dest = path.join(stageDir, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(entry.src, dest);
    }

    // Create tarball from staging dir
    const stagedNames = ['manifest.json', ...entries.map(e => e.name)];

    await tar.create(
      {
        gzip: true,
        file: tempPath,
        cwd: stageDir,
        portable: true,
      },
      stagedNames
    );

    // Atomic rename
    fs.renameSync(tempPath, outputPath);

  } catch (e) {
    // Clean up temp file on error
    try { fs.unlinkSync(tempPath); } catch {}
    if (e.code === 'ENOSPC') {
      console.error('Disk full — archive not created. Free up space and retry.');
    } else {
      console.error(`Archive creation failed: ${e.message}`);
    }
    process.exit(1);
  } finally {
    // Clean up staging dir
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  // Step 8 — print summary
  const stat = fs.statSync(outputPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

  console.log('');
  console.log(`Archive: ${outputPath}  (${sizeMB} MB)`);
  console.log('');
  console.log('Included:');
  console.log('  manifest.json');
  if (hasEnv) {
    const envStat = fs.statSync(ENV_FILE);
    console.log(`  .env  (${(envStat.size / 1024).toFixed(1)} KB)`);
  }
  for (const archiveName of includedFiles) {
    const abs = path.join(DATA_PERSISTENT, archiveName.slice('persistent/'.length));
    const s = fs.statSync(abs);
    console.log(`  ${archiveName}  (${(s.size / 1024).toFixed(1)} KB)`);
  }
  for (const entry of seedEntries) {
    const s = fs.statSync(entry.src);
    console.log(`  ${entry.name}  (${(s.size / 1024).toFixed(1)} KB)`);
  }
  console.log('');
  console.log('Skipped:');
  console.log('  sessions.db       (machine-bound Express sessions)');
  console.log('  runtimeData.json  (ephemeral in-memory snapshot)');
  console.log('  certs/            (machine-bound TLS certs — regenerate on destination)');
  // Surface any per-file skips the walk recorded (corrupt .db, prefix/suffix
  // matches, etc.) — these aren't part of the standard machine-bound list.
  const extraSkips = skipped.filter(s =>
    !s.startsWith('persistent/sessions.db') &&
    !s.includes('runtimeData')
  );
  for (const s of extraSkips) {
    console.log(`  ${s}`);
  }
  const archiveName = path.basename(outputPath);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('NEXT STEPS — copy to another machine and import:');
  console.log('');
  console.log('  1. Copy the archive to the target machine:');
  console.log(`       scp ${outputPath} user@target-machine:~/`);
  console.log('');
  console.log('  2. On the target machine, clone the repo and install all packages:');
  console.log('       git clone https://github.com/curtismu7/AI-demo.git && cd AI-demo');
  console.log('       cd demo_api_server && npm install && cd ..');
  console.log('       cd oauth-mcp  && npm install && cd ..');
  console.log('       cd demo_api_ui      && npm install --legacy-peer-deps && cd ..');
  console.log('');
  console.log('  3. Import the archive:');
  console.log('       cd demo_api_server');
  console.log(`       npm run data:import -- ~/${archiveName}`);
  console.log('');
  console.log('  4. Generate TLS certs (machine-bound — not in archive):');
  console.log('       cd ../certs && mkcert -cert-file api.ping.demo+2.pem -key-file api.ping.demo+2-key.pem api.ping.demo local.ping-devops.com demo-api-server localhost 127.0.0.1 && cd ..');
  console.log('');
  console.log('  5. Start the server:');
  console.log('       ./run-demo.sh');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('SECURITY: This archive contains your .env and all');
  console.log('database secrets. Treat it like your .env file:');
  console.log('  - Do NOT commit to git');
  console.log('  - Do NOT upload to public storage');
  console.log('  - Transfer via secure channel (scp, encrypted USB, etc.)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((e) => {
  console.error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
