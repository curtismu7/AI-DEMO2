'use strict';

/**
 * Regressions from the vault review — the "fails open where it should fail
 * closed" class:
 *
 *   #4  vaultLoader returned {loaded:false} for a MISSING vault file before the
 *       missing-password guard ran, so deleting the file (or missing a bind
 *       mount) booted the BFF with every vault secret absent and only an
 *       info-level log.
 *   #10 a failed audit write was swallowed, so chmod 0444 on the log silenced
 *       the trail while every vault operation kept succeeding.
 *   #12 vault entries never reached process.env, so routes reading
 *       process.env.BFF_INTERNAL_SECRET fell back to the committed public
 *       default once the operator followed vault-migrate's advice to strip it
 *       from .env.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVault, openVault } = require('../../lib/vault');
const { recordAudit, assertAuditWritable } = require('../../lib/vault/audit');

const PASSWORD = 'fail-closed-test-password';

let dir;
let vaultPath;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-failclosed-'));
  vaultPath = path.join(dir, 'secrets.vault');
});

afterEach(async () => {
  delete process.env.VAULT_REQUIRED;
  delete process.env.BFF_INTERNAL_SECRET;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('#4 missing vault file', () => {
  const loadVault = () => require('../../services/vaultLoader').loadVaultIntoConfigStore;

  test('is a no-op by default so a fresh clone still runs', async () => {
    const result = await loadVault()({
      vaultPath,
      password: PASSWORD,
      configStore: { ensureInitialized: async () => {}, setRaw: async () => {} },
      logger: { log() {}, error() {} },
      isVercel: false,
    });

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('no_vault_file');
  });

  test('refuses to start when VAULT_REQUIRED=true', async () => {
    process.env.VAULT_REQUIRED = 'true';

    await expect(
      loadVault()({
        vaultPath,
        password: PASSWORD,
        configStore: { ensureInitialized: async () => {}, setRaw: async () => {} },
        logger: { log() {}, error() {} },
        isVercel: false,
      }),
    ).rejects.toMatchObject({ code: 'VAULT_FILE_MISSING' });
  });
});

describe('#10 audit log tamper-evidence', () => {
  test('a mutating op refuses to proceed when the audit log is unwritable', () => {
    const auditFile = path.join(dir, 'unwritable.audit.log');
    fs.writeFileSync(auditFile, '');
    fs.chmodSync(auditFile, 0o444);

    expect(() =>
      recordAudit(auditFile, { op: 'set', key: 'X', caller: 'vault.js', result: 'ok' }),
    ).toThrow(/audit log is not writable/);
  });

  test('a non-mutating op stays best-effort', () => {
    const auditFile = path.join(dir, 'unwritable2.audit.log');
    fs.writeFileSync(auditFile, '');
    fs.chmodSync(auditFile, 0o444);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      recordAudit(auditFile, { op: 'read', key: 'X', caller: 'vault.js', result: 'ok' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('opening a vault whose audit log is unwritable fails closed', async () => {
    const v = await createVault(vaultPath, PASSWORD);
    v.set('SOME_ENTRY', 'value');
    await v.save();
    v.close();

    fs.chmodSync(`${vaultPath}.audit.log`, 0o444);

    await expect(openVault(vaultPath, PASSWORD)).rejects.toMatchObject({
      code: 'VAULT_AUDIT_UNWRITABLE',
    });

    fs.chmodSync(`${vaultPath}.audit.log`, 0o600);
  });

  test('the audit log is created 0600, not at the process umask', async () => {
    const v = await createVault(vaultPath, PASSWORD);
    v.close();

    const mode = fs.statSync(`${vaultPath}.audit.log`).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('assertAuditWritable passes for a writable path', () => {
    expect(() => assertAuditWritable(path.join(dir, 'fresh.audit.log'))).not.toThrow();
  });
});

describe('#12 BFF_INTERNAL_SECRET resolves lazily', () => {
  test('internalSecret reflects a value set AFTER the module was required', () => {
    const { internalSecret, isDefaultInternalSecret } = require('../../utils/internalSecret');

    expect(isDefaultInternalSecret()).toBe(true);

    // The vault loads long after routes are required; a module-scope snapshot
    // would still be showing the committed default here.
    process.env.BFF_INTERNAL_SECRET = 'from-the-vault';

    expect(internalSecret()).toBe('from-the-vault');
    expect(isDefaultInternalSecret()).toBe(false);
  });

  test('internalSecretMatches is exact and rejects the wrong secret', () => {
    const { internalSecretMatches } = require('../../utils/internalSecret');
    process.env.BFF_INTERNAL_SECRET = 'the-right-secret';

    expect(internalSecretMatches('the-right-secret')).toBe(true);
    expect(internalSecretMatches('the-wrong-secret')).toBe(false);
    expect(internalSecretMatches('short')).toBe(false);
    expect(internalSecretMatches(undefined)).toBe(false);
  });
});
