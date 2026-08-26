'use strict';

/**
 * CLI regression suite (Phase 269, Plan 02, Task 1).
 *
 * Pattern: unit-style. Mocks @inquirer/password and ../../lib/vault so behavior
 * is asserted purely against the dispatch/glue logic in scripts/vault.js,
 * independent of real Argon2id KDF (slow) or real filesystem I/O.
 *
 * Companion integration suite (cli.integration.test.js) covers the same
 * subcommands end-to-end via child_process.spawnSync with a real vault file.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// @inquirer/password is an ESM-only module loaded via dynamic import in
// scripts/vault.js. Rather than fight Jest's ESM intercept (which requires
// --experimental-vm-modules), the CLI wraps the prompt in a `_promptForPassword`
// helper that we override on the module exports in beforeEach below.

const mockPasswordPrompt = jest.fn();

// Vault library mock — captures openVault/createVault calls and returns a stub
// handle whose methods can be inspected and re-stubbed per-test.
const mockHandle = {
  read: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  list: jest.fn(),
  rotate: jest.fn(),
  save: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
};
const mockOpenVault = jest.fn().mockResolvedValue(mockHandle);
const mockCreateVault = jest.fn().mockResolvedValue(mockHandle);

jest.mock('../../lib/vault', () => {
  class VaultAuthError extends Error {
    constructor(m) { super(m); this.name = 'VaultAuthError'; }
  }
  class VaultIntegrityError extends Error {
    constructor(m) { super(m); this.name = 'VaultIntegrityError'; }
  }
  class VaultNotFoundError extends Error {
    constructor(m) { super(m); this.name = 'VaultNotFoundError'; }
  }
  class VaultEntryNotFoundError extends Error {
    constructor(m) { super(m); this.name = 'VaultEntryNotFoundError'; }
  }
  class VaultPasswordRequiredError extends Error {
    constructor(m) { super(m); this.name = 'VaultPasswordRequiredError'; }
  }
  return {
    // `mockOpenVault`/`mockCreateVault` are jest-allowed names (prefix `mock`).
    openVault: (...a) => mockOpenVault(...a),
    createVault: (...a) => mockCreateVault(...a),
    VaultAuthError,
    VaultIntegrityError,
    VaultNotFoundError,
    VaultEntryNotFoundError,
    VaultPasswordRequiredError,
  };
});

const cli = require('../../scripts/vault');

// Replace the dynamic-import-backed prompt helper with a jest mock so we can
// observe and stub its return value across tests.
const originalPromptForPassword = cli._promptForPassword;
const originalReadAllStdin = cli._readAllStdin;
beforeEach(() => {
  cli._promptForPassword = mockPasswordPrompt;
  mockPasswordPrompt.mockReset();
  // Reset the stdin reader to the real one; the cmdSet stdin tests below stub
  // it per-test with a resolved value (deterministic — no racing emits on the
  // shared global process.stdin, which flaked/hung under the full parallel suite).
  cli._readAllStdin = originalReadAllStdin;
  // WR-02: defense vs VAULT_PASSWORD / VAULT_NEW_PASSWORD leaking in from a
  // parallel test file (Jest workers share process.env across suites in the
  // same worker). Individual `describe` blocks below set these explicitly when
  // they need them — start clean to avoid by-luck ordering.
  delete process.env.VAULT_PASSWORD;
  delete process.env.VAULT_NEW_PASSWORD;
});
afterAll(() => {
  cli._promptForPassword = originalPromptForPassword;
  cli._readAllStdin = originalReadAllStdin;
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function spyStdout() {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}
function spyStderr() {
  return jest.spyOn(console, 'error').mockImplementation(() => {});
}

describe('vault CLI — argument parsing', () => {
  test('parseArgsAndDispatch maps "get NAME" to subcommand+name', () => {
    expect(cli.parseArgsAndDispatch(['get', 'HELIX_API_KEY'])).toEqual({
      subcommand: 'get',
      name: 'HELIX_API_KEY',
    });
  });

  test('parseArgsAndDispatch maps "set NAME" to subcommand+name', () => {
    expect(cli.parseArgsAndDispatch(['set', 'HELIX_API_KEY'])).toEqual({
      subcommand: 'set',
      name: 'HELIX_API_KEY',
    });
  });

  test('parseArgsAndDispatch maps "list" with no name', () => {
    expect(cli.parseArgsAndDispatch(['list'])).toEqual({
      subcommand: 'list',
      name: undefined,
    });
  });

  test('parseArgsAndDispatch maps "create" with no name', () => {
    expect(cli.parseArgsAndDispatch(['create'])).toEqual({
      subcommand: 'create',
      name: undefined,
    });
  });

  test('parseArgsAndDispatch throws on unknown subcommand', () => {
    expect(() => cli.parseArgsAndDispatch(['unknown-cmd'])).toThrow(
      /unknown subcommand/,
    );
  });

  test('parseArgsAndDispatch throws on empty argv', () => {
    expect(() => cli.parseArgsAndDispatch([])).toThrow(/unknown subcommand/);
  });
});

describe('vault CLI — getPassword', () => {
  test('returns env password when provided (non-TTY)', async () => {
    const pw = await cli.getPassword({ isTTY: false, envPassword: 'x' });
    expect(pw).toBe('x');
    expect(mockPasswordPrompt).not.toHaveBeenCalled();
  });

  test('returns env password when provided (TTY)', async () => {
    const pw = await cli.getPassword({ isTTY: true, envPassword: 'x' });
    expect(pw).toBe('x');
    expect(mockPasswordPrompt).not.toHaveBeenCalled();
  });

  test('throws fail-fast on non-TTY with no env password', async () => {
    await expect(
      cli.getPassword({ isTTY: false, envPassword: undefined }),
    ).rejects.toThrow(/vault password required/);
  });

  test('calls @inquirer/password.default exactly once on TTY without env', async () => {
    mockPasswordPrompt.mockResolvedValue('typed-pw');
    const pw = await cli.getPassword({
      isTTY: true,
      envPassword: undefined,
    });
    expect(pw).toBe('typed-pw');
    expect(mockPasswordPrompt).toHaveBeenCalledTimes(1);
  });
});

describe('vault CLI — subcommand handlers', () => {
  let stdoutSpy;
  let stderrSpy;
  let originalIsTTY;

  beforeEach(() => {
    stdoutSpy = spyStdout();
    stderrSpy = spyStderr();
    originalIsTTY = process.stdin.isTTY;
    // Default to non-TTY so handlers take the env-password / stdin path.
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => false,
    });
    process.env.VAULT_PASSWORD = 'pw-1';
    process.env.VAULT_PATH = '/tmp/regression-test.vault';

    mockOpenVault.mockClear().mockResolvedValue(mockHandle);
    mockCreateVault.mockClear().mockResolvedValue(mockHandle);
    mockHandle.read.mockReset();
    mockHandle.set.mockReset();
    mockHandle.delete.mockReset();
    mockHandle.list.mockReset();
    mockHandle.rotate.mockReset();
    mockHandle.save.mockReset().mockResolvedValue(undefined);
    mockHandle.close.mockReset();
    process.exitCode = 0;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => originalIsTTY,
    });
    delete process.env.VAULT_PASSWORD;
    delete process.env.VAULT_PATH;
    delete process.env.VAULT_NEW_PASSWORD;
    process.exitCode = 0;
  });

  test('cmdGet prints ONLY the decrypted value + newline to stdout', async () => {
    mockHandle.read.mockReturnValue('helix-secret');
    await cli.cmdGet('HELIX_API_KEY');
    // Only one stdout write, with exactly value + '\n'
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith('helix-secret\n');
    expect(mockHandle.close).toHaveBeenCalled();
  });

  test('cmdGet deletes VAULT_PASSWORD from env after openVault returns', async () => {
    mockHandle.read.mockReturnValue('v');
    await cli.cmdGet('FOO');
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
  });

  test('cmdList prints names one per line to stdout, never values', async () => {
    mockHandle.list.mockReturnValue(['A', 'B', 'C']);
    await cli.cmdList();
    expect(stdoutSpy).toHaveBeenCalledTimes(3);
    expect(stdoutSpy).toHaveBeenNthCalledWith(1, 'A\n');
    expect(stdoutSpy).toHaveBeenNthCalledWith(2, 'B\n');
    expect(stdoutSpy).toHaveBeenNthCalledWith(3, 'C\n');
    expect(mockHandle.read).not.toHaveBeenCalled();
  });

  test('cmdDelete on missing entry sets exit code 2 with stderr message', async () => {
    mockHandle.delete.mockReturnValue(false);
    await cli.cmdDelete('MISSING');
    expect(process.exitCode).toBe(2);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('entry not found'),
    );
    // save() must NOT be called when the delete was a no-op.
    expect(mockHandle.save).not.toHaveBeenCalled();
  });

  test('cmdDelete on existing entry returns ok and saves', async () => {
    mockHandle.delete.mockReturnValue(true);
    await cli.cmdDelete('FOO');
    expect(process.exitCode).toBe(0);
    expect(mockHandle.save).toHaveBeenCalled();
  });

  test('cmdSet on new vault prints no-recovery warning BEFORE calling createVault', async () => {
    // Provide stdin value via mocked readAllStdin path — create a fake stdin stream.
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    // Inject the non-TTY stdin value deterministically (matches `echo 'val' | …`,
    // which appends a trailing newline that cmdSet trims).
    cli._readAllStdin = jest.fn().mockResolvedValue('val\n');

    await cli.cmdSet('FOO');

    // First stderr calls were the no-recovery warning, BEFORE createVault.
    const stderrCallOrder = stderrSpy.mock.invocationCallOrder;
    const createCallOrder = mockCreateVault.mock.invocationCallOrder[0];
    expect(stderrCallOrder[0]).toBeLessThan(createCallOrder);

    // The warning text appears on stderr.
    const warnedRecovery = stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('no password recovery'),
    );
    expect(warnedRecovery).toBe(true);

    expect(mockCreateVault).toHaveBeenCalled();
    expect(mockHandle.set).toHaveBeenCalledWith('FOO', 'val');
    expect(mockHandle.save).toHaveBeenCalled();
    fs.existsSync.mockRestore();
  });

  // WR-05: empty stdin should exit non-zero, NOT silently store ''.
  test('cmdSet with empty stdin (non-TTY) exits 1 and does NOT call vault.set', async () => {
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true); // vault exists
    // Empty stdin — simulates `vault:set X < /dev/null`.
    cli._readAllStdin = jest.fn().mockResolvedValue('');

    await cli.cmdSet('FOO');

    expect(process.exitCode).toBe(1);
    expect(mockHandle.set).not.toHaveBeenCalled();
    expect(mockHandle.save).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('refusing to set FOO to empty value'),
    )).toBe(true);
    fs.existsSync.mockRestore();
  });

  test('cmdSet with whitespace-only newline stdin (non-TTY) exits 1', async () => {
    // `echo '' | vault:set X` produces a single '\n' on stdin which trims to ''.
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    cli._readAllStdin = jest.fn().mockResolvedValue('\n');

    await cli.cmdSet('BAR');

    expect(process.exitCode).toBe(1);
    expect(mockHandle.set).not.toHaveBeenCalled();
    fs.existsSync.mockRestore();
  });

  test('cmdRotate prints no-recovery warning before rotate; uses VAULT_NEW_PASSWORD in non-TTY', async () => {
    process.env.VAULT_NEW_PASSWORD = 'pw-2';
    await cli.cmdRotate();
    expect(stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('no password recovery'),
    )).toBe(true);
    expect(mockHandle.rotate).toHaveBeenCalledWith('pw-2');
    expect(mockHandle.save).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  test('cmdRotate fails non-zero without VAULT_NEW_PASSWORD in non-TTY', async () => {
    delete process.env.VAULT_NEW_PASSWORD;
    await cli.cmdRotate();
    expect(process.exitCode).toBe(1);
    expect(mockHandle.rotate).not.toHaveBeenCalled();
  });

  test('cmdCreate NEVER reads stdin (no process.stdin.on listener attached)', async () => {
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const stdinOnSpy = jest.spyOn(process.stdin, 'on');
    await cli.cmdCreate();
    expect(stdinOnSpy).not.toHaveBeenCalled();
    expect(mockCreateVault).toHaveBeenCalledTimes(1);
    expect(mockHandle.save).toHaveBeenCalled();
    expect(mockHandle.close).toHaveBeenCalled();
    stdinOnSpy.mockRestore();
    fs.existsSync.mockRestore();
  });

  test('cmdCreate fails non-zero when vault file already exists', async () => {
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    await cli.cmdCreate();
    expect(process.exitCode).toBe(1);
    expect(mockCreateVault).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('already exists'),
    )).toBe(true);
    fs.existsSync.mockRestore();
  });

  test('cmdCreate prints no-recovery warning before createVault', async () => {
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    await cli.cmdCreate();
    expect(stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('no password recovery'),
    )).toBe(true);
    expect(mockCreateVault).toHaveBeenCalled();
    fs.existsSync.mockRestore();
  });

  test('cmdCreate with no VAULT_PASSWORD in non-TTY fails fast (getPassword throws)', async () => {
    const fs = require('node:fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    delete process.env.VAULT_PASSWORD;
    await expect(cli.cmdCreate()).rejects.toThrow(/vault password required/);
    expect(mockCreateVault).not.toHaveBeenCalled();
    fs.existsSync.mockRestore();
  });
});

describe('vault CLI — dropPasswordFromEnv helper', () => {
  test('removes VAULT_PASSWORD from process.env', () => {
    process.env.VAULT_PASSWORD = 'temp';
    cli.dropPasswordFromEnv();
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
  });

  test('is safe to call when VAULT_PASSWORD is already unset', () => {
    delete process.env.VAULT_PASSWORD;
    expect(() => cli.dropPasswordFromEnv()).not.toThrow();
  });
});

describe('vault CLI — resolveVaultPath', () => {
  const original = process.env.VAULT_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = original;
  });

  test('returns VAULT_PATH when set', () => {
    process.env.VAULT_PATH = '/some/where/foo.vault';
    expect(cli.resolveVaultPath()).toBe('/some/where/foo.vault');
  });

  test('defaults to repo-root/secrets.vault when env unset', () => {
    delete process.env.VAULT_PATH;
    const p = cli.resolveVaultPath();
    expect(p.endsWith('/secrets.vault')).toBe(true);
  });
});


describe('vault CLI — module.exports is assigned before main() runs', () => {
  // Regression: the `if (require.main === module) main()` block used to sit
  // ABOVE `module.exports = {...}`. getPassword() reaches through
  // module.exports._promptForPassword (and cmdSet() through
  // module.exports._readAllStdin) for test-stubbability, so on a TTY the CLI
  // died with "module.exports._promptForPassword is not a function" before it
  // could ever prompt — every subcommand was unusable interactively.
  //
  // This asserts source order rather than behavior: reproducing the crash needs
  // a real TTY, and pty allocation differs between macOS and Linux CI.
  test('the require.main block appears after the exports assignment', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'vault.js'),
      'utf8',
    );
    const exportsAt = src.indexOf('module.exports = {');
    const mainAt = src.indexOf('require.main === module');
    expect(exportsAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(exportsAt);
  });
});
