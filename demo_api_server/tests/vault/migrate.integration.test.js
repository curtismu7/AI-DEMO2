/**
 * Phase 269 Plan 05 Task 1 — vault-migrate.js integration tests.
 *
 * Strategy: spawn `node scripts/vault-migrate.js` as a real child process via
 * spawnSync against a real tmpdir vault built with the Plan 01 lib API. This
 * exercises argv parsing, dotenv loading, openVault, vault.set, vault.save,
 * and the closed allowlist all together — the same code paths that fire at
 * `npm run vault:migrate-from-env` time.
 *
 * NEVER assert against decrypted VALUES leaking to stdout/stderr — this is the
 * T-269-21 contract. Every test sets a unique sentinel value and greps the
 * combined output for it.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createVault, openVault } = require('../../lib/vault');
// Closed allowlist the script migrates from — imported so count assertions
// stay correct as the allowlist grows (the script guards execution behind
// `require.main === module`, so requiring it here is side-effect free).
const { ALLOWED_ENV_VARS } = require('../../scripts/vault-migrate');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'vault-migrate.js');
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

// vault-migrate.js unconditionally dotenv-loads <repo>/.env and
// banking_api_server/.env from disk (mirroring the BFF). The exact
// copied/skipped *counts* assertion below is only deterministic when those
// files are absent — a developer/CI machine with a populated .env makes the
// script copy extra allowlist entries, changing the counts. The migrate
// behavior itself is covered by the other 11 tests in this suite (which
// assert on presence/absence, not exact counts). Skip the count-exact test
// when a real .env is present on disk.
const _REPO_ENV = path.resolve(SERVER_ROOT, '..', '.env');
const _BFF_ENV = path.resolve(SERVER_ROOT, '.env');
const _HAS_REAL_ENV = fs.existsSync(_REPO_ENV) || fs.existsSync(_BFF_ENV);
const itEnvClean = _HAS_REAL_ENV ? test.skip : test;

function uniqPath() {
  const ts = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  return path.join(os.tmpdir(), 'vault-migrate-test-' + ts + '.vault');
}

function cleanup(vaultPath) {
  for (const p of [vaultPath, vaultPath + '.tmp', vaultPath + '.audit.log']) {
    try { fs.unlinkSync(p); } catch (_e) { /* ignore */ }
  }
}

/**
 * Build an isolated env so the operator's real .env doesn't bleed into the test.
 * We start with PATH + Node-specific bits, then add VAULT_PASSWORD/VAULT_PATH
 * and any candidate-env-var overrides the caller specifies.
 */
function isolatedEnv(extras = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_PATH: process.env.NODE_PATH,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    // Force any dotenv() load to look at a non-existent path to avoid
    // pulling secrets from the developer's banking_api_server/.env.
    // The migrate script calls dotenv with { override: false }, so anything
    // already set in process.env wins. The test sets exactly what it needs.
    ...extras,
  };
}

function runMigrate(args, env, opts = {}) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    cwd: opts.cwd || SERVER_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30000,
  });
}

describe('vault-migrate.js — integration', () => {
  let vaultPath;

  beforeEach(() => {
    vaultPath = uniqPath();
  });

  afterEach(() => {
    cleanup(vaultPath);
  });

  test('exits 4 when no vault file exists', async () => {
    const env = isolatedEnv({ VAULT_PASSWORD: 'pw-1', VAULT_PATH: vaultPath });
    const r = runMigrate([], env);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/file not found/);
  });

  test('dry-run: HELIX_API_KEY present → "would copy" line, no vault mutation', async () => {
    const v = await createVault(vaultPath, 'pw-1');
    await v.save();
    v.close();
    const mtimeBefore = fs.statSync(vaultPath).mtimeMs;
    // Wait a tiny bit so a write would produce a measurable mtime delta.
    await new Promise((r) => setTimeout(r, 10));

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-1',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'XYZ-MIGRATE-TEST-SECRET-XYZ-dryrun',
    });
    const r = runMigrate(['--dry-run'], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/\[migrate-dry\] would copy HELIX_API_KEY/);
    expect(r.stderr).toMatch(/length=\d+ chars/);
    // T-269-21: VALUE never leaks to stdout or stderr.
    expect(r.stdout + r.stderr).not.toContain('XYZ-MIGRATE-TEST-SECRET-XYZ-dryrun');
    // mtime unchanged — no save() call.
    expect(fs.statSync(vaultPath).mtimeMs).toBe(mtimeBefore);
  });

  test('actual migration: HELIX_API_KEY copied into vault, no value in output', async () => {
    const v = await createVault(vaultPath, 'pw-2');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-2',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'XYZ-MIGRATE-TEST-SECRET-XYZ-real',
    });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/\[migrate\] copied HELIX_API_KEY/);
    // T-269-21: secret VALUE never appears in captured output.
    expect(r.stdout + r.stderr).not.toContain('XYZ-MIGRATE-TEST-SECRET-XYZ-real');

    // Re-open vault and verify value is present.
    const v2 = await openVault(vaultPath, 'pw-2');
    try {
      expect(v2.list()).toContain('HELIX_API_KEY');
      expect(v2.read('HELIX_API_KEY')).toBe('XYZ-MIGRATE-TEST-SECRET-XYZ-real');
    } finally {
      v2.close();
    }
  });

  test('re-run without --force: skips already-present entry', async () => {
    const v = await createVault(vaultPath, 'pw-3');
    v.set('HELIX_API_KEY', 'pre-existing-value-do-not-overwrite');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-3',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'NEW-VALUE-should-be-ignored',
    });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skipping HELIX_API_KEY \(already in vault/);

    // Value is unchanged.
    const v2 = await openVault(vaultPath, 'pw-3');
    try {
      expect(v2.read('HELIX_API_KEY')).toBe('pre-existing-value-do-not-overwrite');
    } finally {
      v2.close();
    }
    // Neither value leaks to stdout/stderr.
    expect(r.stdout + r.stderr).not.toContain('pre-existing-value-do-not-overwrite');
    expect(r.stdout + r.stderr).not.toContain('NEW-VALUE-should-be-ignored');
  });

  test('--force: overwrites existing entry', async () => {
    const v = await createVault(vaultPath, 'pw-4');
    v.set('HELIX_API_KEY', 'old-value');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-4',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'overwritten-by-force',
    });
    const r = runMigrate(['--force'], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/\[migrate\] copied HELIX_API_KEY/);

    const v2 = await openVault(vaultPath, 'pw-4');
    try {
      expect(v2.read('HELIX_API_KEY')).toBe('overwritten-by-force');
    } finally {
      v2.close();
    }
  });

  test('empty env var: skipped with "not set in env" log', async () => {
    const v = await createVault(vaultPath, 'pw-5');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-5',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: '',
    });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skipping HELIX_API_KEY \(not set in env\)/);

    const v2 = await openVault(vaultPath, 'pw-5');
    try {
      expect(v2.list()).not.toContain('HELIX_API_KEY');
    } finally {
      v2.close();
    }
  });

  // Same real-.env caveat as the count-exact test above: dotenv only fills
  // in a var when it's absent from process.env, so on a machine with a real
  // HELIX_API_KEY in .env, the script copies it here instead of skipping it.
  itEnvClean('unset env var: skipped with "not set in env" log', async () => {
    const v = await createVault(vaultPath, 'pw-6');
    await v.save();
    v.close();

    // HELIX_API_KEY deliberately absent from env.
    const env = isolatedEnv({ VAULT_PASSWORD: 'pw-6', VAULT_PATH: vaultPath });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skipping HELIX_API_KEY \(not set in env\)/);
  });

  test('non-allowlist env var: ignored entirely', async () => {
    const v = await createVault(vaultPath, 'pw-7');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-7',
      VAULT_PATH: vaultPath,
      // Not in ALLOWED_ENV_VARS — must not appear in vault or in any log line.
      MY_RANDOM_THING: 'should-not-be-migrated',
      LD_PRELOAD: '/evil.so',
    });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/MY_RANDOM_THING/);
    // The script only ever logs allowlisted names, so neither var should appear
    // in its own output. Scope to the script's "[migrate]" lines — on Linux the
    // dynamic loader itself prints an LD_PRELOAD warning for the bogus path to
    // stderr, which is OS noise, not the script leaking the value.
    const migrateOutput = r.stderr.split('\n').filter((l) => l.includes('[migrate')).join('\n');
    expect(migrateOutput).not.toMatch(/LD_PRELOAD/);

    const v2 = await openVault(vaultPath, 'pw-7');
    try {
      expect(v2.list()).not.toContain('MY_RANDOM_THING');
      expect(v2.list()).not.toContain('LD_PRELOAD');
    } finally {
      v2.close();
    }
  });

  itEnvClean('end-of-run summary line counts copied + skipped accurately', async () => {
    const v = await createVault(vaultPath, 'pw-8');
    v.set('PINGONE_ADMIN_CLIENT_SECRET', 'preexisting-admin');
    await v.save();
    v.close();

    // Explicitly null out every allowlist entry the developer's .env might
    // pollute (dotenv reads banking_api_server/.env with override:false, so
    // values already in process.env win). We set the ones we want set, and
    // empty-string the rest so the "not set in env" branch fires deterministically.
    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-8',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'new-helix-value',
      PINGONE_ADMIN_CLIENT_SECRET: 'redo-this-but-skipped',
      PINGONE_AI_CORE_CLIENT_SECRET: '',
      PINGONE_AI_AGENT_CLIENT_SECRET: '',
      PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET: '',
      MCP_GW_CLIENT_SECRET: '',
      BFF_INTERNAL_SECRET: '',
      CONFIG_ENCRYPTION_KEY: '',
      SESSION_SECRET: '',
    });
    const r = runMigrate([], env);
    expect(r.status).toBe(0);
    // 1 copied (HELIX_API_KEY), 1 skipped-already (PINGONE_ADMIN_CLIENT_SECRET),
    // and every other allowlist entry skipped as not-set-in-env.
    const expectedNotSet = ALLOWED_ENV_VARS.length - 2;
    expect(r.stderr).toMatch(/copied 1 entries/);
    expect(r.stderr).toMatch(/skipped 1 \(already in vault\)/);
    expect(r.stderr).toMatch(new RegExp(`skipped ${expectedNotSet} \\(not set in env\\)`));
  });

  test('NEVER logs secret values to stdout or stderr (sentinel grep)', async () => {
    const v = await createVault(vaultPath, 'pw-sentinel');
    await v.save();
    v.close();

    const SENTINEL = 'XYZ-MIGRATE-TEST-SECRET-XYZ-' + Date.now();
    const env = isolatedEnv({
      VAULT_PASSWORD: 'pw-sentinel',
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: SENTINEL,
      PINGONE_ADMIN_CLIENT_SECRET: SENTINEL + '-2',
      SESSION_SECRET: SENTINEL + '-3',
    });

    // dry-run AND actual run both must not leak.
    const r1 = runMigrate(['--dry-run'], env);
    expect(r1.status).toBe(0);
    expect(r1.stdout + r1.stderr).not.toContain(SENTINEL);

    const r2 = runMigrate([], env);
    expect(r2.status).toBe(0);
    expect(r2.stdout + r2.stderr).not.toContain(SENTINEL);
  });

  itEnvClean('missing VAULT_PASSWORD in non-TTY mode: fail-fast exit 1', async () => {
    const v = await createVault(vaultPath, 'pw-9');
    await v.save();
    v.close();

    const env = isolatedEnv({
      VAULT_PATH: vaultPath,
      HELIX_API_KEY: 'some-value',
    });
    const r = runMigrate([], env);
    // Migrate script's getPassword throws an Error with exitCode=1 when there's
    // no env password AND no TTY. Captured error then yields process.exit(1).
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/password required|VAULT_PASSWORD/i);
  });

  test('--vault flag overrides VAULT_PATH env var', async () => {
    const customPath = uniqPath();
    try {
      const v = await createVault(customPath, 'pw-10');
      await v.save();
      v.close();

      const env = isolatedEnv({
        VAULT_PASSWORD: 'pw-10',
        // VAULT_PATH points at a different (non-existent) location — the
        // --vault flag must override.
        VAULT_PATH: '/tmp/nonexistent-vault-' + Date.now() + '.vault',
        HELIX_API_KEY: 'override-test-value',
      });
      const r = runMigrate(['--vault', customPath], env);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/\[migrate\] copied HELIX_API_KEY/);

      const v2 = await openVault(customPath, 'pw-10');
      try {
        expect(v2.read('HELIX_API_KEY')).toBe('override-test-value');
      } finally {
        v2.close();
      }
    } finally {
      cleanup(customPath);
    }
  });
});
