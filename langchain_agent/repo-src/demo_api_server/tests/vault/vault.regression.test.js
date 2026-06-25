'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  openVault,
  createVault,
  VaultAuthError,
  VaultNotFoundError,
  VaultEntryNotFoundError,
  VaultIntegrityError,
} = require('../../lib/vault');

// Argon2id KDF runs at vault open + rotate; allow generous timeout for CI.
jest.setTimeout(60000);

function tmpVaultPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-rgr-'));
  return path.join(dir, 'test.vault');
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

describe('vault: createVault / openVault basics', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('createVault writes parseable envelope; reopening with same password succeeds', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.close();
    const v2 = await openVault(p, 'pw');
    expect(v2.list()).toEqual([]);
    v2.close();
  });

  test('createVault throws if file exists', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.close();
    await expect(createVault(p, 'pw')).rejects.toThrow(/already exists/);
  });

  test("set('K','V'); save(); reopen; read('K') === 'V'", async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('K', 'V');
    await v.save();
    v.close();
    const v2 = await openVault(p, 'pw');
    expect(v2.read('K')).toBe('V');
    v2.close();
  });

  test("set('K','V1'); save(); set('K','V2'); save(); reopen; read('K') === 'V2'", async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('K', 'V1');
    await v.save();
    v.set('K', 'V2');
    await v.save();
    v.close();
    const v2 = await openVault(p, 'pw');
    expect(v2.read('K')).toBe('V2');
    v2.close();
  });

  test("set('A','1'); set('B','2'); save(); reopen; list().sort() === ['A','B']", async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('A', '1');
    v.set('B', '2');
    await v.save();
    v.close();
    const v2 = await openVault(p, 'pw');
    expect(v2.list().sort()).toEqual(['A', 'B']);
    v2.close();
  });

  test("delete('A'); save(); reopen; read('A') throws VaultEntryNotFoundError; delete returns false on missing", async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('A', '1');
    await v.save();
    expect(v.delete('A')).toBe(true);
    expect(v.delete('NOPE')).toBe(false);
    await v.save();
    v.close();
    const v2 = await openVault(p, 'pw');
    expect(() => v2.read('A')).toThrow(VaultEntryNotFoundError);
    v2.close();
  });
});

describe('vault: open errors are opaque', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test("openVault(path, 'wrong') throws VaultAuthError; message does NOT mention argon2/kek/dek", async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'right');
    v.close();
    let caught;
    try {
      await openVault(p, 'wrong');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VaultAuthError);
    expect(caught.message).not.toMatch(/argon/i);
    expect(caught.message).not.toMatch(/kek/i);
    expect(caught.message).not.toMatch(/dek/i);
  });

  test('openVault on missing file throws VaultNotFoundError', async () => {
    const fakePath = path.join(os.tmpdir(), 'vault-rgr-missing', 'nope.vault');
    await expect(openVault(fakePath, 'pw')).rejects.toThrow(VaultNotFoundError);
  });
});

describe('vault: handle lifecycle', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('close(); read("K") throws Error containing "closed"', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('K', 'V');
    await v.save();
    v.close();
    expect(() => v.read('K')).toThrow(/closed/);
  });
});

describe('vault: rotate', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('rotate("new"); save(); reopen with new password works; old password fails', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'old');
    v.set('K', 'V');
    await v.rotate('new');
    await v.save();
    v.close();

    const v2 = await openVault(p, 'new');
    expect(v2.read('K')).toBe('V');
    v2.close();

    await expect(openVault(p, 'old')).rejects.toThrow(VaultAuthError);
  });
});

describe('vault: per-entry sealing (binary diff)', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('adding entry C does NOT change A or B ciphertext bytes on disk', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('A', 'aaa');
    v.set('B', 'bbb');
    await v.save();
    const before = JSON.parse(fs.readFileSync(p, 'utf8'));
    const aBefore = { ...before.entries.A };
    const bBefore = { ...before.entries.B };

    v.set('C', 'ccc');
    await v.save();
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.entries.A.value).toBe(aBefore.value);
    expect(after.entries.A.valueIv).toBe(aBefore.valueIv);
    expect(after.entries.A.valueTag).toBe(aBefore.valueTag);
    expect(after.entries.A.updatedAt).toBe(aBefore.updatedAt);
    expect(after.entries.B.value).toBe(bBefore.value);
    expect(after.entries.B.valueIv).toBe(bBefore.valueIv);
    expect(after.entries.B.valueTag).toBe(bBefore.valueTag);
    expect(after.entries.B.updatedAt).toBe(bBefore.updatedAt);

    v.close();
  });
});

describe('vault: input validation', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('set("lowercase","x") throws (name validation)', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    expect(() => v.set('lowercase', 'x')).toThrow(/name must match/);
    v.close();
  });

  test('set("VALID", "x".repeat(64*1024+1)) throws (value size cap)', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    expect(() => v.set('VALID', 'x'.repeat(64 * 1024 + 1))).toThrow(/64 KiB/);
    v.close();
  });
});

describe('vault: tampered file detection', () => {
  let p;
  afterEach(() => p && cleanupVault(p));

  test('flipping a byte in a saved entry value triggers integrity / auth error on reopen', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    v.set('X', 'secret-value');
    await v.save();
    v.close();

    const env = JSON.parse(fs.readFileSync(p, 'utf8'));
    const buf = Buffer.from(env.entries.X.value, 'base64');
    buf[0] ^= 0xff;
    env.entries.X.value = buf.toString('base64');
    fs.writeFileSync(p, JSON.stringify(env));

    let caught;
    try {
      await openVault(p, 'pw');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(
      caught instanceof VaultIntegrityError || caught instanceof VaultAuthError,
    ).toBe(true);
  });

  // WR-01: KDF param tampering should fail fast in parseEnvelope, BEFORE the
  // ~100ms Argon2id derive. Asserts both error type and that the call returned
  // in well under one full Argon2id cost (a single derive @ m=64MiB/t=3/p=4
  // measures ~60-300ms on the test box; we cap the failure budget at 200ms
  // which is comfortably below a single derive but well above a JSON parse).
  test('downgraded kdf.memCost in envelope throws VaultIntegrityError WITHOUT running deriveKek', async () => {
    p = tmpVaultPath();
    const v = await createVault(p, 'pw');
    await v.save();
    v.close();

    const env = JSON.parse(fs.readFileSync(p, 'utf8'));
    env.kdf.memCost = 1; // downgrade attempt
    fs.writeFileSync(p, JSON.stringify(env));

    const t0 = Date.now();
    let caught;
    try {
      await openVault(p, 'pw');
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - t0;
    expect(caught).toBeInstanceOf(VaultIntegrityError);
    expect(caught.message).toMatch(/unsupported kdf parameters/);
    // Confirm the failure path skipped deriveKek (which would dominate at
    // ~60ms+). Generous ceiling for CI noise; tighten only if it flakes low.
    expect(elapsed).toBeLessThan(200);
  });
});
