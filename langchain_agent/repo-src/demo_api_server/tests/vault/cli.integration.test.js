'use strict';

/**
 * CLI integration suite (Phase 269, Plan 02, Task 2).
 *
 * Pattern: end-to-end via child_process.spawnSync. Real argon2 KDF, real
 * filesystem, real vault library — no mocks. Each test uses a fresh tmpdir
 * vault path so suites can run in parallel without colliding.
 *
 * Companion regression suite (cli.regression.test.js) covers the same
 * subcommands with mocked vault + prompt for fast logic-only coverage.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const VAULT_SCRIPT = path.resolve(__dirname, '../../scripts/vault.js');

// Real Argon2id runs at every open (~60-300ms on dev/CI). Set generous timeout.
jest.setTimeout(60000);

/**
 * Spawn the vault CLI synchronously.
 * @param {string[]} args            CLI argv after `node vault.js …`
 * @param {object}   opts
 * @param {string}   opts.input      bytes to write to child stdin
 * @param {object}   opts.env        env-var overlay on top of {VAULT_PATH, CI}
 * @param {boolean}  opts.stdinIgnored — mimic setupFresh.js's runChild()
 *                                        (stdio:['ignore','pipe','pipe']) so the
 *                                        child's stdin is /dev/null.
 * @returns {object} spawnSync result
 */
function runVault(args, { input = '', env = {}, stdinIgnored = false } = {}) {
  // Build a CLEAN env: start from process.env but strip VAULT_PASSWORD /
  // VAULT_NEW_PASSWORD / VAULT_PATH so tests don't inherit accidentally.
  const baseEnv = { ...process.env };
  delete baseEnv.VAULT_PASSWORD;
  delete baseEnv.VAULT_NEW_PASSWORD;
  delete baseEnv.VAULT_PATH;
  return spawnSync('node', [VAULT_SCRIPT, ...args], {
    env: { ...baseEnv, ...env, CI: 'true' },
    stdio: stdinIgnored ? ['ignore', 'pipe', 'pipe'] : undefined,
    input: stdinIgnored ? undefined : input,
    encoding: 'utf8',
    timeout: 30000,
  });
}

describe('vault CLI integration', () => {
  let tmpDir;
  let vaultPath;
  let envBase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-cli-'));
    vaultPath = path.join(tmpDir, 'test.vault');
    envBase = { VAULT_PATH: vaultPath };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('create with stdin:ignore (setupFresh.js pattern) creates an empty vault', () => {
    const r = runVault(['create'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
      stdinIgnored: true,
    });
    if (r.status !== 0) {
      // surface stderr if assertion fails — easier debugging in CI logs
      // eslint-disable-next-line no-console
      console.error('create stderr:', r.stderr, '\nstdout:', r.stdout);
    }
    expect(r.status).toBe(0);
    expect(fs.existsSync(vaultPath)).toBe(true);
    // Verify the new vault is empty by listing it.
    const r2 = runVault(['list'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r2.status).toBe(0);
    expect(r2.stdout).toBe('');
  });

  test('create fails when vault file already exists (no silent overwrite)', () => {
    const r1 = runVault(['create'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
      stdinIgnored: true,
    });
    expect(r1.status).toBe(0);
    const r2 = runVault(['create'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-2' },
      stdinIgnored: true,
    });
    expect(r2.status).toBe(1);
    expect(r2.stderr).toMatch(/already exists/);
    // Existing vault still opens with the ORIGINAL password.
    const r3 = runVault(['list'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r3.status).toBe(0);
  });

  test('create without VAULT_PASSWORD in non-TTY mode fails fast', () => {
    const r = runVault(['create'], { env: envBase, stdinIgnored: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/vault password required/);
    expect(fs.existsSync(vaultPath)).toBe(false);
  });

  test('create prints no-recovery warning to stderr', () => {
    const r = runVault(['create'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
      stdinIgnored: true,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no password recovery/);
  });

  test('set creates new vault when none exists and writes entry', () => {
    const r = runVault(['set', 'GREETING'], {
      input: 'hello-world',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(vaultPath)).toBe(true);
  });

  test('get returns the exact value previously set (no trailing junk)', () => {
    runVault(['set', 'GREETING'], {
      input: 'hello-world',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r = runVault(['get', 'GREETING'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('hello-world\n');
  });

  test('list prints entry names, never values', () => {
    runVault(['set', 'A'], {
      input: '1',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    runVault(['set', 'B'], {
      input: '2',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r = runVault(['list'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(0);
    const names = r.stdout.trim().split('\n').sort();
    expect(names).toEqual(['A', 'B']);
    // Values must NEVER appear on stdout — only names.
    expect(r.stdout).not.toContain('1');
    expect(r.stdout).not.toContain('2');
  });

  test('delete removes entry; subsequent get exits 2 with "entry not found"', () => {
    runVault(['set', 'X'], {
      input: 'v',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r1 = runVault(['delete', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r1.status).toBe(0);
    const r2 = runVault(['get', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/entry not found/);
  });

  test('delete of missing entry exits 2', () => {
    runVault(['set', 'X'], {
      input: 'v',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r = runVault(['delete', 'MISSING'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(2);
  });

  test('get with wrong password exits 3 with generic message (no oracle)', () => {
    runVault(['set', 'X'], {
      input: 'v',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r = runVault(['get', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'wrong-pw' },
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/vault: open failed/);
    // The error message must NOT leak which crypto stage failed.
    expect(r.stderr).not.toMatch(/argon|kek|dek/i);
  });

  test('get on missing vault file exits 4', () => {
    const r = runVault(['get', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/vault: file not found/);
  });

  test('rotate changes password; old password fails with same generic message', () => {
    runVault(['set', 'X'], {
      input: 'v',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const rRotate = runVault(['rotate'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1', VAULT_NEW_PASSWORD: 'pw-2' },
    });
    expect(rRotate.status).toBe(0);
    // New password works
    const rNew = runVault(['get', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-2' },
    });
    expect(rNew.status).toBe(0);
    expect(rNew.stdout).toBe('v\n');
    // Old password fails with the SAME generic message as a tampered file.
    const rOld = runVault(['get', 'X'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(rOld.status).toBe(3);
    expect(rOld.stderr).toMatch(/vault: open failed/);
  });

  test('non-TTY without VAULT_PASSWORD exits 1 with clear message', () => {
    // Establish a vault first
    runVault(['set', 'X'], {
      input: 'v',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    // Now request without VAULT_PASSWORD — runVault strips inherited vars.
    const r = runVault(['get', 'X'], { env: envBase });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/vault password required/);
  });

  test('stdout of get is pipe-clean (no banner, no warning, exactly value + \\n)', () => {
    runVault(['set', 'TOKEN'], {
      input: 'eyJhbGciOiJIUzI1NiJ9',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    const r = runVault(['get', 'TOKEN'], {
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('eyJhbGciOiJIUzI1NiJ9\n');
    // stderr is allowed to have the non-interactive env note — only stdout
    // must be value-only.
  });

  test('set prints no-recovery warning to stderr', () => {
    const r = runVault(['set', 'GREETING'], {
      input: 'hello-world',
      env: { ...envBase, VAULT_PASSWORD: 'pw-1' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no password recovery/);
  });
});
