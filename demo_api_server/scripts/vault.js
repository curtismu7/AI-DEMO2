#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Operator CLI for the portable encrypted credential vault (Phase 269).
 *
 * Subcommands (one per npm script in banking_api_server/package.json):
 *   create        → create an EMPTY vault file (never reads stdin)
 *   get  <name>   → print decrypted value to stdout (pipe-friendly)
 *   set  <name>   → set/overwrite an entry (value via stdin or TTY prompt)
 *   list          → print entry names, one per line (NEVER values)
 *   delete <name> → remove an entry
 *   rotate        → rotate vault password (re-wrap all DEKs)
 *
 * Password supply (T-269-06):
 *   - VAULT_PASSWORD env var takes precedence
 *   - TTY interactive → @inquirer/password (no echo, masked)
 *   - Non-TTY without VAULT_PASSWORD → fail-fast with clear message
 *   - After openVault/createVault returns, VAULT_PASSWORD is deleted from
 *     process.env to shrink the /proc/<pid>/environ leak window.
 *
 * Stdout discipline (T-269-11):
 *   - vault:get   writes ONLY the decrypted value + '\n' to stdout
 *   - vault:list  writes ONLY entry names (one per line) to stdout
 *   - Everything else (banners, warnings, success messages) goes to STDERR
 *
 * No-recovery warning (T-269-04):
 *   - Printed before create, set, and rotate (any operation that can change
 *     what is required to open the vault). No --admin-reset flag exists.
 *
 * Exit codes:
 *   0  ok
 *   1  generic error (incl. password-required, file-already-exists)
 *   2  entry not found (VaultEntryNotFoundError)
 *   3  auth failed / tampered file (VaultAuthError, VaultIntegrityError)
 *   4  vault file not found (VaultNotFoundError)
 *   64 unknown subcommand (sysexits EX_USAGE)
 */

const path = require('node:path');
const fs = require('node:fs');
const { Command } = require('commander');
const vaultLib = require('../lib/vault');
const {
  VaultAuthError,
  VaultIntegrityError,
  VaultNotFoundError,
  VaultEntryNotFoundError,
} = vaultLib;

const VALID_SUBCOMMANDS = ['create', 'get', 'set', 'list', 'delete', 'rotate'];
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function resolveVaultPath() {
  return process.env.VAULT_PATH || path.join(REPO_ROOT, 'secrets.vault');
}

// ─── Password supply (T-269-06, T-269-08) ─────────────────────────────────────

// Thin wrapper around the @inquirer/password ESM module. Factored out so jest
// tests can replace the entire prompt helper without needing
// --experimental-vm-modules to intercept the dynamic import.
async function _promptForPassword(message) {
  const mod = await import('@inquirer/password');
  return mod.default({ message, mask: '*' });
}

async function getPassword({
  isTTY = !!process.stdin.isTTY,
  envPassword = process.env.VAULT_PASSWORD,
  promptMessage = 'Vault password:',
} = {}) {
  if (envPassword) {
    if (!isTTY) {
      // T-269-08: log to stderr (NOT stdout) so vault:get stays pipe-clean.
      console.error('⚠️  Using VAULT_PASSWORD from env (non-interactive mode)');
    }
    return envPassword;
  }
  if (!isTTY) {
    const err = new Error(
      'vault password required: set VAULT_PASSWORD env or run interactively',
    );
    err.exitCode = 1;
    throw err;
  }
  // Interactive TTY: prompt with masked input (no echo).
  return module.exports._promptForPassword(promptMessage);
}

function dropPasswordFromEnv() {
  // T-269-06: shrink the env-var leak window after the password has done its job.
  delete process.env.VAULT_PASSWORD;
}

function printNoRecoveryWarning() {
  // T-269-04: warn every time before an op that can change the "what you need
  // to open the vault" — create, set, rotate.
  console.error(
    '⚠️  There is no password recovery. Lose this password and the vault must be',
  );
  console.error(
    '   rebuilt from source secrets (regenerate Helix key, worker secrets, etc.).',
  );
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

// cmdCreate: creates an EMPTY vault file. NEVER reads stdin — designed for
// setupFresh.js's runChild() which sets child stdin to /dev/null
// (stdio:['ignore','pipe','pipe']). Password comes from VAULT_PASSWORD env or
// TTY prompt; if neither is available, getPassword throws fail-fast.
async function cmdCreate() {
  const vaultPath = resolveVaultPath();
  if (fs.existsSync(vaultPath)) {
    // T-269-30: never silently overwrite an existing vault.
    console.error(
      'vault: file already exists at ' +
        vaultPath +
        ' (use vault:rotate or vault:delete first)',
    );
    process.exitCode = 1;
    return;
  }
  printNoRecoveryWarning();
  const password = await getPassword({ promptMessage: 'New vault password:' });
  let vault;
  try {
    vault = await vaultLib.createVault(vaultPath, password);
  } catch (err) {
    console.error('vault: create failed: ' + err.message);
    process.exitCode = 1;
    return;
  }
  dropPasswordFromEnv();
  try {
    await vault.save();
    console.error('✅ vault: created at ' + vaultPath);
  } finally {
    vault.close();
  }
}

async function cmdGet(name) {
  const password = await getPassword();
  const vault = await vaultLib.openVault(resolveVaultPath(), password);
  dropPasswordFromEnv();
  try {
    const value = vault.read(name);
    // T-269-11: ONLY the value goes to stdout (no banner, no log).
    process.stdout.write(value + '\n');
  } finally {
    vault.close();
  }
}

async function cmdSet(name) {
  const vaultPath = resolveVaultPath();
  const exists = fs.existsSync(vaultPath);
  printNoRecoveryWarning();
  const password = await getPassword({
    promptMessage: exists ? 'Vault password:' : 'New vault password:',
  });
  let vault;
  if (!exists) {
    console.error('No vault at ' + vaultPath + ' — creating new vault.');
    vault = await vaultLib.createVault(vaultPath, password);
  } else {
    vault = await vaultLib.openVault(vaultPath, password);
  }
  dropPasswordFromEnv();
  try {
    let value;
    if (process.stdin.isTTY) {
      // T-269-13: values are secrets — mask them too.
      value = await module.exports._promptForPassword('Value for ' + name + ':');
    } else {
      // Indirected through module.exports so tests can stub stdin reading
      // deterministically (mirrors _promptForPassword) instead of racing
      // emits on the shared global process.stdin.
      value = await module.exports._readAllStdin();
      // Trim a single trailing newline that `echo 'v' | …` always appends.
      if (value.endsWith('\n')) value = value.slice(0, -1);
      // WR-05: refuse to silently write an empty value when stdin is closed
      // (e.g. `vault:set FOO < /dev/null` or a piped command that produced
      // no output). Without this guard the entry is set to '' and the
      // audit log shows op:set,result:ok with no signal anything went wrong.
      if (value === '') {
        console.error(
          'vault: refusing to set ' + name + ' to empty value (stdin was empty)',
        );
        process.exitCode = 1;
        return;
      }
    }
    vault.set(name, value);
    await vault.save();
    console.error('✅ vault: set ' + name);
  } finally {
    vault.close();
  }
}

async function cmdList() {
  const password = await getPassword();
  const vault = await vaultLib.openVault(resolveVaultPath(), password);
  dropPasswordFromEnv();
  try {
    for (const entryName of vault.list()) {
      process.stdout.write(entryName + '\n');
    }
  } finally {
    vault.close();
  }
}

async function cmdDelete(name) {
  const password = await getPassword();
  const vault = await vaultLib.openVault(resolveVaultPath(), password);
  dropPasswordFromEnv();
  try {
    const had = vault.delete(name);
    if (!had) {
      console.error('vault: entry not found: ' + name);
      process.exitCode = 2;
      return;
    }
    await vault.save();
    console.error('✅ vault: deleted ' + name);
  } finally {
    vault.close();
  }
}

async function cmdRotate() {
  const password = await getPassword({
    promptMessage: 'Current vault password:',
  });
  const vault = await vaultLib.openVault(resolveVaultPath(), password);
  dropPasswordFromEnv();
  try {
    printNoRecoveryWarning();
    let newPw;
    if (process.stdin.isTTY) {
      newPw = await module.exports._promptForPassword('New vault password:');
      const confirm = await module.exports._promptForPassword(
        'Confirm new password:',
      );
      if (newPw !== confirm) {
        console.error('❌ vault: passwords do not match');
        process.exitCode = 1;
        return;
      }
    } else {
      newPw = process.env.VAULT_NEW_PASSWORD;
      if (!newPw) {
        console.error(
          'vault: rotate requires VAULT_NEW_PASSWORD env in non-interactive mode',
        );
        process.exitCode = 1;
        return;
      }
    }
    await vault.rotate(newPw);
    await vault.save();
    console.error('✅ vault: password rotated');
  } finally {
    vault.close();
  }
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ─── Argument parsing ─────────────────────────────────────────────────────────
//
// We pre-validate the subcommand ourselves so callers (tests AND main) get a
// deterministic error shape for unknown subcommands. Commander is used to
// describe subcommands in --help output but the dispatch itself is hand-rolled.

function parseArgsAndDispatch(argv) {
  // Build a commander program purely for --help/description metadata. It is
  // intentionally NOT used to dispatch — we do that below from `argv` directly.
  const program = new Command();
  program.name('vault').description('Encrypted credential vault CLI');
  program.command('create').description('Create an empty vault file (never reads stdin)');
  program.command('get <name>').description('Print decrypted value to stdout');
  program.command('set <name>').description('Set or overwrite an entry');
  program.command('list').description('List entry names (never values)');
  program.command('delete <name>').description('Remove an entry');
  program.command('rotate').description('Rotate the vault password');
  // Reference `program` so linters and humans see it's not dead code — it
  // contributes to --help if commander.help() were called downstream.
  void program;

  const subcommand = argv[0];
  const name = argv[1];
  if (!subcommand || !VALID_SUBCOMMANDS.includes(subcommand)) {
    const err = new Error('unknown subcommand: ' + (subcommand || '<missing>'));
    err.exitCode = 64;
    throw err;
  }
  return { subcommand, name };
}

async function main() {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgsAndDispatch(argv);
  } catch (err) {
    console.error('vault: ' + err.message);
    process.exit(err.exitCode || 64);
  }
  try {
    switch (parsed.subcommand) {
      case 'create':
        await cmdCreate();
        break;
      case 'get':
        await cmdGet(parsed.name);
        break;
      case 'set':
        await cmdSet(parsed.name);
        break;
      case 'list':
        await cmdList();
        break;
      case 'delete':
        await cmdDelete(parsed.name);
        break;
      case 'rotate':
        await cmdRotate();
        break;
    }
  } catch (err) {
    if (err instanceof VaultEntryNotFoundError) {
      console.error(err.message);
      process.exit(2);
    } else if (err instanceof VaultAuthError || err instanceof VaultIntegrityError) {
      console.error(err.message);
      process.exit(3);
    } else if (err instanceof VaultNotFoundError) {
      console.error(err.message);
      process.exit(4);
    } else {
      console.error('vault: ' + (err.message || err));
      process.exit(err.exitCode || 1);
    }
  }
}

// Run only when invoked directly. When require()'d by tests, exports are used.
if (require.main === module) {
  main();
}

module.exports = {
  parseArgsAndDispatch,
  getPassword,
  dropPasswordFromEnv,
  printNoRecoveryWarning,
  resolveVaultPath,
  _promptForPassword,
  _readAllStdin: readAllStdin,
  cmdCreate,
  cmdGet,
  cmdSet,
  cmdList,
  cmdDelete,
  cmdRotate,
};
