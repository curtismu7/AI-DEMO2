'use strict';

/**
 * Regression: `save()` wrote to a shared `<vaultPath>.tmp`, so it was neither
 * atomic nor safe.
 *
 *   1. Two concurrent savers wrote the same tmp path — their JSON interleaved,
 *      one rename published the splice, and the vault became unreadable.
 *   2. `writeFile(tmp, ..., { mode: 0o600 })` silently kept an existing file's
 *      looser mode, and followed a symlink pre-planted at the predictable path.
 *   3. The later save() silently discarded the other handle's entries.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVault, openVault, VaultIntegrityError } = require('../../lib/vault');

const PASSWORD = 'atomic-save-test-password';

let dir;
let vaultPath;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-atomic-'));
  vaultPath = path.join(dir, 'secrets.vault');
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('save() is atomic and durable', () => {
  test('concurrent savers do not corrupt the vault', async () => {
    const seed = await createVault(vaultPath, PASSWORD);
    await seed.save();
    seed.close();

    const h1 = await openVault(vaultPath, PASSWORD);
    const h2 = await openVault(vaultPath, PASSWORD);

    for (let i = 0; i < 200; i += 1) {
      h1.set(`BULK_ENTRY_${i}`, 'x'.repeat(200));
    }
    h2.set('SMALL_ENTRY', 'y');

    // One of these may legitimately reject with the generation guard; what must
    // never happen is an unreadable vault.
    await Promise.allSettled([h1.save(), h2.save()]);
    h1.close();
    h2.close();

    const reopened = await openVault(vaultPath, PASSWORD);
    expect(reopened.list().length).toBeGreaterThan(0);
    reopened.close();
  });

  test('a second handle cannot silently discard the first handle\'s entries', async () => {
    const seed = await createVault(vaultPath, PASSWORD);
    await seed.save();
    seed.close();

    const h1 = await openVault(vaultPath, PASSWORD);
    const h2 = await openVault(vaultPath, PASSWORD);

    h1.set('FIRST_WRITER', 'one');
    await h1.save();

    h2.set('SECOND_WRITER', 'two');
    await expect(h2.save()).rejects.toThrow(VaultIntegrityError);

    h1.close();
    h2.close();

    const reopened = await openVault(vaultPath, PASSWORD);
    expect(reopened.read('FIRST_WRITER')).toBe('one');
    reopened.close();
  });

  test('a symlink at the legacy tmp path cannot capture the envelope', async () => {
    const seed = await createVault(vaultPath, PASSWORD);
    await seed.save();
    seed.close();

    const stolen = path.join(dir, 'stolen-envelope');
    fs.symlinkSync(stolen, `${vaultPath}.tmp`);

    const h = await openVault(vaultPath, PASSWORD);
    h.set('SECRET_ENTRY', 'value');
    await h.save();
    h.close();

    expect(fs.existsSync(stolen)).toBe(false);
  });

  test('the saved vault is 0600 even if a looser file sits at the legacy tmp path', async () => {
    const seed = await createVault(vaultPath, PASSWORD);
    await seed.save();
    seed.close();

    fs.writeFileSync(`${vaultPath}.tmp`, 'pre-existing', { mode: 0o644 });
    fs.chmodSync(`${vaultPath}.tmp`, 0o644);

    const h = await openVault(vaultPath, PASSWORD);
    h.set('SECRET_ENTRY', 'value');
    await h.save();
    h.close();

    const mode = fs.statSync(vaultPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('no tmp file is left behind after a successful save', async () => {
    const seed = await createVault(vaultPath, PASSWORD);
    await seed.save();
    seed.close();

    const h = await openVault(vaultPath, PASSWORD);
    h.set('SECRET_ENTRY', 'value');
    await h.save();
    h.close();

    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
