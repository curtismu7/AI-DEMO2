'use strict';

// VAULT_AUDIT_LOG_PATH relocates the audit trail without weakening it.
//
// The trail defaults to a sibling of the vault file. In Docker that sibling is
// /secrets.vault.audit.log — container root, owned by root, while the BFF runs
// as appuser — so the fail-closed writability check at open threw EACCES and the
// whole BFF refused to start. These tests pin both halves: the override is
// honoured, and it moves WHERE the log lives, never WHETHER it is enforced.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVault, openVault } = require('../../lib/vault');

const PASSWORD = 'correct horse battery staple';

let tmpDir;
let vaultPath;
const savedEnv = process.env.VAULT_AUDIT_LOG_PATH;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-auditpath-'));
  vaultPath = path.join(tmpDir, 'secrets.vault');
  delete process.env.VAULT_AUDIT_LOG_PATH;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.VAULT_AUDIT_LOG_PATH;
  else process.env.VAULT_AUDIT_LOG_PATH = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('VAULT_AUDIT_LOG_PATH', () => {
  test('unset: the trail lands beside the vault (unchanged default)', async () => {
    await createVault(vaultPath, PASSWORD);

    expect(fs.existsSync(`${vaultPath}.audit.log`)).toBe(true);
  });

  test('set: the trail lands at the override, not beside the vault', async () => {
    const override = path.join(tmpDir, 'writable', 'audit.log');
    fs.mkdirSync(path.dirname(override), { recursive: true });
    process.env.VAULT_AUDIT_LOG_PATH = override;

    await createVault(vaultPath, PASSWORD);

    expect(fs.existsSync(override)).toBe(true);
    expect(fs.existsSync(`${vaultPath}.audit.log`)).toBe(false);
    expect(fs.readFileSync(override, 'utf8')).toMatch(/"op":"open"/);
  });

  test('operations keep recording to the override after open', async () => {
    const override = path.join(tmpDir, 'audit.log');
    process.env.VAULT_AUDIT_LOG_PATH = override;

    await createVault(vaultPath, PASSWORD);
    const vault = await openVault(vaultPath, PASSWORD);
    await vault.set('API_KEY', 'value-1');

    const lines = fs.readFileSync(override, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.op === 'set' && l.key === 'API_KEY')).toBe(true);
    // The value itself must never reach the trail.
    expect(fs.readFileSync(override, 'utf8')).not.toContain('value-1');
  });

  test('an unwritable override still fails closed — enforcement is not softened', async () => {
    process.env.VAULT_AUDIT_LOG_PATH = path.join(tmpDir, 'no-such-dir', 'audit.log');

    await expect(createVault(vaultPath, PASSWORD)).rejects.toThrow(/audit log is not writable/);
  });
});
