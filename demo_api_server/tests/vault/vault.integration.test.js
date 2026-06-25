'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openVault, createVault } = require('../../lib/vault');

// Integration tests exercise real filesystem + real audit log writes.
jest.setTimeout(60000);

function tmpVaultPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-int-'));
  return path.join(dir, 'test.vault');
}

function readAudit(vaultPath) {
  const raw = fs.readFileSync(vaultPath + '.audit.log', 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function cleanupVault(p) {
  for (const sfx of ['', '.tmp', '.audit.log']) {
    try {
      fs.unlinkSync(p + sfx);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmdirSync(path.dirname(p));
  } catch {
    /* ignore */
  }
}

describe('vault integration: full round-trip + audit log', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('create → set → save → close → open → read → close produces 5+ audit lines', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('HELIX_API_KEY', 'sk-live-XXX');
    await v.save();
    v.close();

    const v2 = await openVault(p, 'pw');
    expect(v2.read('HELIX_API_KEY')).toBe('sk-live-XXX');
    v2.close();

    const lines = readAudit(p);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      expect(line.pid).toBe(process.pid);
      expect(line.caller).toBe('vault.js');
      expect(line.host).toBe(os.hostname());
      expect(typeof line.ts).toBe('string');
    }
  });

  test('audit file lives next to the vault as <vault>.audit.log', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.close();
    expect(fs.existsSync(p + '.audit.log')).toBe(true);
  });
});

describe('vault integration: atomic save', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('save writes <vault>.tmp then renames to <vault> (spy on fsp.rename)', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('A', '1');

    const renameSpy = jest.spyOn(fsp, 'rename');
    await v.save();
    v.close();

    // Among the rename calls (create + save), every call must be tmp → final.
    expect(renameSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of renameSpy.mock.calls) {
      const [src, dst] = call;
      expect(src).toBe(p + '.tmp');
      expect(dst).toBe(p);
    }
    renameSpy.mockRestore();
  });
});

describe('vault integration: opaque error parity (no oracle)', () => {
  test('wrong password and tampered file produce the SAME generic message', async () => {
    const p1 = tmpVaultPath();
    const p2 = tmpVaultPath();
    let err1;
    let err2;
    try {
      const v = await createVault(p1, 'right');
      v.set('X', 'V');
      await v.save();
      v.close();
      try {
        await openVault(p1, 'wrong');
      } catch (e) {
        err1 = e;
      }

      // Tampered file (HMAC mismatch).
      const v2 = await createVault(p2, 'right');
      v2.set('X', 'V');
      await v2.save();
      v2.close();
      const env = JSON.parse(fs.readFileSync(p2, 'utf8'));
      env.createdAt = '2026-05-13T99:99:99Z'; // outside the HMAC; alters fileHmac body
      fs.writeFileSync(p2, JSON.stringify(env));
      try {
        await openVault(p2, 'right');
      } catch (e) {
        err2 = e;
      }
    } finally {
      cleanupVault(p1);
      cleanupVault(p2);
    }
    expect(err1).toBeDefined();
    expect(err2).toBeDefined();
    expect(err1.message).toBe(err2.message);
    expect(err1.message).toMatch(/bad password or tampered file/);
  });
});

describe('vault integration: KEK zeroed on close', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('after close(), _kekZeroedForTesting() returns true', async () => {
    p = tmpVaultPath();
    process.env.VAULT_TEST_HOOK = 'true';
    try {
      const v = await createVault(p, 'pw');
      v.set('X', 'V');
      await v.save();
      expect(v._kekZeroedForTesting()).toBe(false); // KEK still live
      v.close();
      expect(v._kekZeroedForTesting()).toBe(true); // KEK zeroed
    } finally {
      delete process.env.VAULT_TEST_HOOK;
    }
  });
});

describe('vault integration: audit log contents', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('audit log contains expected ops and no entry values', async () => {
    p = tmpVaultPath();
    const SECRET = 'XXX-SECRET-XXX';
    const v = await createVault(p, 'pw');
    v.set('SECRET_KEY', SECRET);
    await v.save();
    v.close();

    const raw = fs.readFileSync(p + '.audit.log', 'utf8');
    // The literal secret value must NOT appear in the audit log.
    expect(raw.includes(SECRET)).toBe(false);

    // But the key name does appear (allowed channel).
    expect(raw.includes('SECRET_KEY')).toBe(true);

    // Lines exist for created/set/save/close at minimum.
    const ops = readAudit(p).map((l) => l.op);
    expect(ops).toEqual(expect.arrayContaining(['open', 'set', 'save', 'close']));
  });
});
