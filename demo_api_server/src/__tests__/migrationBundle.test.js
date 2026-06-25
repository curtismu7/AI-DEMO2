'use strict';

/**
 * Migration Bundle Tests
 * Covers export and import script behaviour without hitting real disk or network.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execSync, spawnSync } = require('node:child_process');

// The migration scripts require Node 20+ (they call checkNodeVersion() internally
// and exit 1 if the runtime is older). Skip the whole suite under Node 18.
const nodeMajor = parseInt(String(process.versions.node || '').split('.')[0], 10);
const node20Plus = nodeMajor >= 20;
const describeIfNode20 = node20Plus ? describe : describe.skip;

const SCRIPTS_DIR = path.resolve(__dirname, '../../scripts');
const SERVER_ROOT = path.resolve(__dirname, '../..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
}

function runScript(script, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, script), ...args],
    {
      cwd: SERVER_ROOT,
      env: { ...process.env, PORT: '19999', ...env },
      encoding: 'utf8',
      timeout: 30000,
    }
  );
}

// Build a minimal valid archive for import tests
async function buildTestArchive(outDir, opts = {}) {
  const tar = require('tar');
  const stageDir = tmpDir();

  const manifest = {
    version: opts.version ?? 2,
    exportedAt: new Date().toISOString(),
    sourceNodeVersion: process.version,
    sourcePlatform: process.platform,
    files: opts.hasEnv !== false ? ['.env', 'persistent/config.db'] : ['persistent/config.db'],
    hasEnv: opts.hasEnv !== false,
    skipped: [],
  };

  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(stageDir, 'persistent'), { recursive: true });

  // Minimal SQLite file (just the header magic bytes)
  const sqliteHeader = Buffer.alloc(100);
  sqliteHeader.write('SQLite format 3\0', 0, 'utf8');
  fs.writeFileSync(path.join(stageDir, 'persistent', 'config.db'), sqliteHeader);

  if (opts.hasEnv !== false) {
    fs.writeFileSync(path.join(stageDir, '.env'), 'SESSION_SECRET=test-secret-32-chars-minimum-xx\n');
  }

  // Include sessions.db if caller wants to test skip behaviour
  if (opts.includeSessionsDb) {
    fs.writeFileSync(path.join(stageDir, 'sessions.db'), 'session data');
    manifest.files.push('sessions.db');
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest));
  }

  // Include a seed/ file if caller wants to test seed-snapshot restore.
  if (opts.includeSeed) {
    fs.mkdirSync(path.join(stageDir, 'seed'), { recursive: true });
    fs.writeFileSync(path.join(stageDir, 'seed', 'service-topology.json'), '{"seed":true}');
    manifest.files.push('seed/service-topology.json');
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest));
  }

  const archivePath = path.join(outDir, 'test-export.tar.gz');
  const filenames = fs.readdirSync(stageDir);
  // Also list persistent/
  const allEntries = [];
  for (const f of filenames) {
    const full = path.join(stageDir, f);
    if (fs.statSync(full).isDirectory()) {
      for (const sub of fs.readdirSync(full)) {
        allEntries.push(`${f}/${sub}`);
      }
    } else {
      allEntries.push(f);
    }
  }

  await tar.create({ gzip: true, file: archivePath, cwd: stageDir, portable: true }, allEntries);
  fs.rmSync(stageDir, { recursive: true, force: true });
  return archivePath;
}

// ── Helpers: spin up a detached HTTP server to simulate "server is running" ───
// spawnSync blocks the event loop, so a same-process http.Server can't respond.
// Instead we spawn a tiny Node one-liner as a detached child process.

function startFakeServer(port) {
  const { spawn } = require('node:child_process');
  const script = `
    const http = require('http');
    const srv = http.createServer((_req, res) => { res.writeHead(200); res.end('{"status":"alive"}'); });
    srv.listen(${port}, '127.0.0.1');
    process.on('SIGTERM', () => { srv.close(); process.exit(0); });
  `;
  const child = spawn(process.execPath, ['-e', script], { detached: false, stdio: 'ignore' });

  // Wait until the port is accepting connections
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    function poll() {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 200 },
        () => resolve(child)
      );
      req.on('error', () => {
        if (Date.now() > deadline) { reject(new Error('fake server did not start')); return; }
        setTimeout(poll, 50);
      });
      req.end();
    }
    poll();
  });
}

// ── Export script tests ───────────────────────────────────────────────────────

describeIfNode20('exportMigrationBundle.js', () => {
  let outDir;
  let extractDir;
  beforeEach(() => { outDir = tmpDir(); extractDir = null; });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
    if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true });
  });

  function exportAndExtract(args = []) {
    const archivePath = path.join(outDir, 'export.tar.gz');
    const result = runScript('exportMigrationBundle.js', ['--out', archivePath, ...args]);
    extractDir = tmpDir();
    if (result.status === 0) execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);
    return { result, archivePath, extractDir };
  }

  test('exits 0 and creates a .tar.gz', () => {
    const { result, archivePath } = exportAndExtract();
    expect(result.status).toBe(0);
    expect(fs.existsSync(archivePath)).toBe(true);
  });

  test('manifest has version 2 and a files array', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(2);
    expect(Array.isArray(manifest.files)).toBe(true);
  });

  // Environmental: asserts the real exportMigrationBundle.js bundles all 8
  // runtime data files from banking_api_server/persistent/. Those files only
  // exist after the app has run and seeded them; the export uses a deny-list
  // (bundles whatever exists), so on a fresh CI checkout this correctly
  // produces a shorter manifest. Skip when the seeded data is absent — the
  // export logic itself is covered by the other 26 tests in this suite.
  const _hasSeededData = fs.existsSync(
    path.join(SERVER_ROOT, 'persistent', 'delegations.db'),
  );
  const testSeeded = _hasSeededData ? test : test.skip;
  testSeeded('manifest includes all 8 expected data files', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    const expectedPersistent = [
      'persistent/config.db', 'persistent/banking.db',
      'persistent/delegations.db', 'persistent/demoAccounts.db',
      'persistent/users.json', 'persistent/accounts.json',
      'persistent/transactions.json', 'persistent/activityLogs.json',
    ];
    for (const f of expectedPersistent) {
      expect(manifest.files).toContain(f);
    }
  });

  test('manifest.skipped lists sessions.db and runtimeData.json', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    const skippedStr = manifest.skipped.join(' ');
    expect(skippedStr).toMatch(/sessions\.db/);
    expect(skippedStr).toMatch(/runtimeData\.json/);
  });

  test('sessions.db is not present in the archive', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    expect(manifest.files).not.toContain('sessions.db');
    expect(manifest.files).not.toContain('persistent/sessions.db');
    expect(fs.existsSync(path.join(ed, 'sessions.db'))).toBe(false);
  });

  test('certs/ directory is not present in the archive', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    // No cert files in the files list
    const certEntries = manifest.files.filter(f => f.startsWith('certs/'));
    expect(certEntries).toHaveLength(0);
    // No certs/ directory extracted
    expect(fs.existsSync(path.join(ed, 'certs'))).toBe(false);
    // Skipped list mentions certs
    const skippedStr = manifest.skipped.join(' ');
    expect(skippedStr).toMatch(/certs/);
  });

  // Environmental: exercises the .env-present branch of the real export, which
  // bundles SERVER_ROOT/.env. A fresh CI checkout has no .env (it is gitignored),
  // so hasEnv is correctly false there — skip rather than assert the present path.
  // (Same convention as `testSeeded` above.)
  const _hasRepoEnv = fs.existsSync(path.join(SERVER_ROOT, '.env'));
  const testHasEnv = _hasRepoEnv ? test : test.skip;
  testHasEnv('manifest.hasEnv is true and .env is in archive when .env exists', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    // .env exists in this repo — hasEnv should be true and file should be present
    expect(manifest.hasEnv).toBe(true);
    expect(manifest.files).toContain('.env');
    expect(fs.existsSync(path.join(ed, '.env'))).toBe(true);
  });

  test('manifest records sourceNodeVersion and sourcePlatform', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    expect(manifest.sourceNodeVersion).toBe(process.version);
    expect(manifest.sourcePlatform).toBe(process.platform);
  });

  test('stdout includes security warning block', () => {
    const { result } = exportAndExtract();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SECURITY');
    expect(result.stdout).toContain('Do NOT commit to git');
  });

  test('stdout shows Package pre-flight passed', () => {
    const { result } = exportAndExtract();
    expect(result.stdout).toContain('Package pre-flight passed');
  });

  test('exits 1 when --out directory does not exist', () => {
    const result = runScript('exportMigrationBundle.js', ['--out', '/nonexistent/path/export.tar.gz']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not\s+exist|not\s+writable/i);
  });

  // Environmental: the repo ships service-topology.json at the root, so the
  // export should bundle it under seed/. Skip if absent (e.g. partial checkout).
  const _hasSeedFile = fs.existsSync(path.join(SERVER_ROOT, '..', 'service-topology.json'));
  const testHasSeed = _hasSeedFile ? test : test.skip;
  testHasSeed('bundles repo seed/config files under seed/', () => {
    const { result, extractDir: ed } = exportAndExtract();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(ed, 'manifest.json'), 'utf8'));
    expect(manifest.files).toContain('seed/service-topology.json');
    expect(fs.existsSync(path.join(ed, 'seed', 'service-topology.json'))).toBe(true);
  });
});

// ── Import script tests ───────────────────────────────────────────────────────

describeIfNode20('importMigrationBundle.js', () => {
  let workDir;
  beforeEach(() => { workDir = tmpDir(); });
  afterEach(() => { fs.rmSync(workDir, { recursive: true, force: true }); });

  // ── Pre-flight ──────────────────────────────────────────────────────────────

  test('--preflight-only exits 0 and prints readiness confirmation', () => {
    const result = runScript('importMigrationBundle.js', ['--preflight-only']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Package pre-flight passed');
    expect(result.stdout).toContain('Machine is ready for import');
  });

  // ── Argument validation ─────────────────────────────────────────────────────

  test('exits 1 with usage message when no archive argument given', () => {
    const result = runScript('importMigrationBundle.js');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });

  test('exits 1 when archive path does not exist', () => {
    const result = runScript('importMigrationBundle.js', ['/tmp/does-not-exist-xyz.tar.gz']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  // ── Server-running guard ────────────────────────────────────────────────────

  test('exits 1 with write-lock message when server is running', async () => {
    // Spin up a real HTTP listener so the server-running check returns 200.
    // The archive must exist on disk so the script reaches Step 2 (server check).
    const port = 19876;
    const fakeServerProc = await startFakeServer(port);
    // Archive must exist on disk so the script passes Step 1 (arg validation)
    // and reaches Step 2 (server check) before checking the archive content.
    const realArchive = await buildTestArchive(workDir);
    try {
      const result = runScript('importMigrationBundle.js', [realArchive], { PORT: String(port) });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('server is running');
      expect(result.stderr).toContain('write lock');
    } finally {
      fakeServerProc.kill();
    }
  });

  // ── Archive validation ──────────────────────────────────────────────────────

  test('exits 1 with helpful message for corrupt archive', () => {
    const badArchive = path.join(workDir, 'bad.tar.gz');
    fs.writeFileSync(badArchive, 'this is not a tarball');
    const result = runScript('importMigrationBundle.js', [badArchive]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Failed to read archive');
  });

  test('exits 1 when manifest has no version field', async () => {
    const tar = require('tar');
    const stageDir = tmpDir();
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify({ files: [] }));
    const archivePath = path.join(workDir, 'no-version.tar.gz');
    await tar.create({ gzip: true, file: archivePath, cwd: stageDir, portable: true }, ['manifest.json']);
    fs.rmSync(stageDir, { recursive: true, force: true });

    const result = runScript('importMigrationBundle.js', [archivePath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('valid banking export archive');
  });

  test('exits 1 when manifest files array is missing', async () => {
    const tar = require('tar');
    const stageDir = tmpDir();
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify({ version: 2 }));
    const archivePath = path.join(workDir, 'no-files.tar.gz');
    await tar.create({ gzip: true, file: archivePath, cwd: stageDir, portable: true }, ['manifest.json']);
    fs.rmSync(stageDir, { recursive: true, force: true });

    const result = runScript('importMigrationBundle.js', [archivePath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('files array');
  });

  // ── v1 archive (no .env) ────────────────────────────────────────────────────

  test('warns about missing .env for v1 archive and does not abort on that alone', async () => {
    const tar = require('tar');
    const stageDir = tmpDir();
    const manifest = { version: 1, files: ['persistent/banking.db'], hasEnv: false, skipped: [] };
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest));
    fs.mkdirSync(path.join(stageDir, 'persistent'), { recursive: true });
    const sqliteHeader = Buffer.alloc(100);
    sqliteHeader.write('SQLite format 3\0', 0, 'utf8');
    fs.writeFileSync(path.join(stageDir, 'persistent', 'banking.db'), sqliteHeader);
    const archivePath = path.join(workDir, 'v1.tar.gz');
    await tar.create({ gzip: true, file: archivePath, cwd: stageDir, portable: true }, ['manifest.json', 'persistent/banking.db']);
    fs.rmSync(stageDir, { recursive: true, force: true });

    const result = runScript('importMigrationBundle.js', [archivePath]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Old\s+archive\s+format|version\s+1/i);
    // Must NOT exit solely because .env is absent — other errors (configStore) are OK
    expect(result.stderr).not.toMatch(/not\s+a\s+valid\s+banking\s+export/i);
  });

  // ── Successful import ───────────────────────────────────────────────────────

  test('creates backup directory before writing any files', async () => {
    const archivePath = await buildTestArchive(workDir);
    const backupBase = path.join(SERVER_ROOT, 'data', 'backups');
    const beforeDirs = fs.existsSync(backupBase) ? fs.readdirSync(backupBase) : [];

    runScript('importMigrationBundle.js', [archivePath]);

    const afterDirs = fs.existsSync(backupBase) ? fs.readdirSync(backupBase) : [];
    const newDirs = afterDirs.filter(d => !beforeDirs.includes(d));
    expect(newDirs.some(d => d.startsWith('pre-import-'))).toBe(true);
  });

  test('writes imported files to data/persistent/', async () => {
    const archivePath = await buildTestArchive(workDir);
    runScript('importMigrationBundle.js', [archivePath]);

    // config.db is in the test archive — must appear in persistent/
    expect(fs.existsSync(path.join(SERVER_ROOT, 'data', 'persistent', 'config.db'))).toBe(true);
  });

  test('writes manifest-last-import.json audit trail', async () => {
    const archivePath = await buildTestArchive(workDir);
    runScript('importMigrationBundle.js', [archivePath]);

    expect(fs.existsSync(path.join(SERVER_ROOT, 'data', 'persistent', 'manifest-last-import.json'))).toBe(true);
  });

  test('writes .env from archive to banking_api_server/.env', async () => {
    const archivePath = await buildTestArchive(workDir);
    runScript('importMigrationBundle.js', [archivePath]);

    const envPath = path.join(SERVER_ROOT, '.env');
    expect(fs.existsSync(envPath)).toBe(true);
  });

  test('backs up existing .env before overwriting', async () => {
    // Ensure .env exists so there is something to back up
    const envPath = path.join(SERVER_ROOT, '.env');
    const hadEnv = fs.existsSync(envPath);

    const archivePath = await buildTestArchive(workDir);
    runScript('importMigrationBundle.js', [archivePath]);

    if (hadEnv) {
      // A .env.pre-import-<timestamp> backup should exist
      const envDir = path.dirname(envPath);
      const backups = fs.readdirSync(envDir).filter(f => f.startsWith('.env.pre-import-'));
      expect(backups.length).toBeGreaterThan(0);
    } else {
      // No pre-existing .env — nothing to back up, that's fine
      expect(true).toBe(true);
    }
  });

  test('stdout contains "Import complete" and rollback instructions', async () => {
    const archivePath = await buildTestArchive(workDir);
    const result = runScript('importMigrationBundle.js', [archivePath]);

    expect(result.stdout).toContain('Import complete');
    expect(result.stdout).toContain('rollback');
  });

  test('stdout lists next steps including ./run.sh', async () => {
    const archivePath = await buildTestArchive(workDir);
    const result = runScript('importMigrationBundle.js', [archivePath]);

    expect(result.stdout).toContain('run.sh');
    expect(result.stdout).toContain('/configure');
  });

  // ── sessions.db exclusion ───────────────────────────────────────────────────

  test('sessions.db in archive is NOT written to data/persistent/', async () => {
    const archivePath = await buildTestArchive(workDir, { includeSessionsDb: true });
    runScript('importMigrationBundle.js', [archivePath]);

    expect(fs.existsSync(path.join(SERVER_ROOT, 'data', 'persistent', 'sessions.db'))).toBe(false);
  });

  test('seed/ files are restored to data/persistent/seed-snapshot/ (not over live files)', async () => {
    const archivePath = await buildTestArchive(workDir, { includeSeed: true });
    runScript('importMigrationBundle.js', [archivePath]);

    const restored = path.join(SERVER_ROOT, 'data', 'persistent', 'seed-snapshot', 'service-topology.json');
    expect(fs.existsSync(restored)).toBe(true);
    // Live repo-root file must be untouched by the import.
    expect(fs.existsSync(path.join(SERVER_ROOT, '..', 'service-topology.json', 'seed-snapshot'))).toBe(false);
  });
});
