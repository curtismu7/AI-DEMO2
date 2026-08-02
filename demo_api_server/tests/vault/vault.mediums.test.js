'use strict';

// Medium-severity vault hardening (PR 3 of the vault review).
//
// Four findings, each pinned by a test that fails against the pre-fix source:
//
//   1. KEK zeroization missed a copy   — deriveKek left argon2's own output
//                                        buffer live after copying out of it
//   2. Salt oracle                     — a wrong-length salt reached argon2 and
//                                        surfaced argon2's bare Error, a
//                                        distinguishable outcome from the
//                                        deliberately generic open failure
//   3. No anti-rollback                — restoring an older secrets.vault
//                                        restored its valid HMAC with it, so
//                                        every integrity check passed
//   4. Audit caller hardcoded          — every line said 'vault.js', so a web
//                                        unlock and a CLI unlock were identical
//                                        in the trail

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVault, openVault, VaultIntegrityError } = require('../../lib/vault');
const { parseEnvelope, canonicalJson, computeFileHmac } = require('../../lib/vault/format');
const { deriveKek, hkdfFileHmacKey } = require('../../lib/vault/crypto');

const PASSWORD = 'correct horse battery staple';

// Argon2id is ~300ms per derivation and these tests open several vaults.
jest.setTimeout(60000);

let tmpDir;
let vaultPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-mediums-'));
  vaultPath = path.join(tmpDir, 'secrets.vault');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const auditLines = () =>
  fs
    .readFileSync(`${vaultPath}.audit.log`, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// 1. KEK zeroization — no orphaned copy
// ---------------------------------------------------------------------------
describe('deriveKek leaves no second copy of the KEK', () => {
  test("zeroes argon2's output buffer after copying out of it", async () => {
    jest.resetModules();
    // The buffer argon2 hands back. Pre-fix, deriveKek copied out of this and
    // returned, leaving these 32 bytes of KEK live on the heap forever — so
    // close()'s kek.fill(0) zeroed one copy and missed this one.
    const argon2Output = Buffer.alloc(32, 0xab);
    jest.doMock('argon2', () => ({
      argon2id: 2,
      hash: jest.fn(async () => argon2Output),
    }));

    const { deriveKek } = require('../../lib/vault/crypto');
    const kek = await deriveKek(PASSWORD, Buffer.alloc(16, 1));

    // The caller gets real key material...
    expect(kek).toHaveLength(32);
    expect(kek.every((b) => b === 0xab)).toBe(true);
    // ...and it is a distinct buffer, so wiping argon2's did not wipe the KEK.
    expect(kek).not.toBe(argon2Output);
    // The buffer the caller can never reach is wiped.
    expect(argon2Output.every((b) => b === 0)).toBe(true);

    jest.dontMock('argon2');
    jest.resetModules();
  });

  test('close() leaves the handle KEK zeroed (unchanged behaviour)', async () => {
    process.env.VAULT_TEST_HOOK = 'true';
    try {
      const vault = await createVault(vaultPath, PASSWORD);
      expect(vault._kekZeroedForTesting()).toBe(false);
      vault.close();
      expect(vault._kekZeroedForTesting()).toBe(true);
    } finally {
      delete process.env.VAULT_TEST_HOOK;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Salt oracle
// ---------------------------------------------------------------------------
describe('salt width is validated before the KDF runs', () => {
  /** Rewrite the on-disk salt to `bytes` wide, leaving everything else intact. */
  const withSaltWidth = (bytes) => {
    const env = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    env.kdf.salt = Buffer.alloc(bytes, 7).toString('base64');
    fs.writeFileSync(vaultPath, canonicalJson(env));
  };

  test('parseEnvelope rejects a short salt as a kdf-parameter failure', async () => {
    await createVault(vaultPath, PASSWORD);
    withSaltWidth(4);

    const buf = fs.readFileSync(vaultPath);
    expect(() => parseEnvelope(buf)).toThrow(VaultIntegrityError);
    // Same message as every other kdf mismatch. A distinct message here would
    // reintroduce the oracle this fix closes.
    expect(() => parseEnvelope(buf)).toThrow(/unsupported kdf parameters/);
  });

  test('parseEnvelope rejects an over-wide salt too', async () => {
    await createVault(vaultPath, PASSWORD);
    withSaltWidth(32);

    expect(() => parseEnvelope(fs.readFileSync(vaultPath))).toThrow(
      /unsupported kdf parameters/,
    );
  });

  test('openVault surfaces a vault error, never argon2 internals', async () => {
    await createVault(vaultPath, PASSWORD);
    withSaltWidth(4);

    // Pre-fix this reached argon2 and threw its bare Error
    // ("Salt should have at least 8 bytes") straight through openVault.
    const err = await openVault(vaultPath, PASSWORD).catch((e) => e);
    expect(err).toBeInstanceOf(VaultIntegrityError);
    expect(err.message).not.toMatch(/salt should have/i);
    expect(err.message).not.toMatch(/argon/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Anti-rollback
// ---------------------------------------------------------------------------
describe('rollback of the vault file is detected', () => {
  test('seq is present and advances on every save', async () => {
    const vault = await createVault(vaultPath, PASSWORD);
    expect(parseEnvelope(fs.readFileSync(vaultPath)).seq).toBe(1);

    vault.set('API_KEY', 'v1');
    await vault.save();
    expect(parseEnvelope(fs.readFileSync(vaultPath)).seq).toBe(2);

    vault.set('API_KEY', 'v2');
    await vault.save();
    expect(parseEnvelope(fs.readFileSync(vaultPath)).seq).toBe(3);
    vault.close();
  });

  test('an older envelope is refused even though its HMAC is valid', async () => {
    const vault = await createVault(vaultPath, PASSWORD);
    vault.set('API_KEY', 'old-value');
    await vault.save();

    // Snapshot exactly what an attacker would keep: a fully valid vault file.
    const stolenSnapshot = fs.readFileSync(vaultPath);

    vault.set('API_KEY', 'rotated-value');
    await vault.save();
    vault.close();

    // Restore the old file. Its magic, version, kdf block and whole-file HMAC
    // are all internally consistent — nothing inside the envelope can tell that
    // it is stale, which is exactly why this used to succeed and silently undo
    // the rotation.
    fs.writeFileSync(vaultPath, stolenSnapshot);

    const err = await openVault(vaultPath, PASSWORD).catch((e) => e);
    expect(err).toBeInstanceOf(VaultIntegrityError);
    expect(err.message).toMatch(/rollback detected/);

    const rollbackLine = auditLines().find((l) => l.result === 'rollback_detected');
    expect(rollbackLine).toBeDefined();
    expect(rollbackLine.op).toBe('open');
  });

  test('a vault written before the counter existed still opens', async () => {
    const vault = await createVault(vaultPath, PASSWORD);
    vault.set('API_KEY', 'v1');
    await vault.save();
    vault.close();

    // Reconstruct exactly what the previous release wrote: no seq field, and a
    // fileHmac correctly computed over the envelope without it. Anything less
    // (dropping seq without re-sealing) would fail on the HMAC and prove
    // nothing about the rollback check.
    const env = parseEnvelope(fs.readFileSync(vaultPath));
    delete env.seq;
    const kek = await deriveKek(PASSWORD, Buffer.from(env.kdf.salt, 'base64'));
    env.fileHmac = computeFileHmac(env, hkdfFileHmacKey(kek));
    kek.fill(0);
    fs.writeFileSync(vaultPath, canonicalJson(env));
    // Nothing witnessed yet, so there is no seq to compare the absence against.
    fs.rmSync(`${vaultPath}.audit.log`, { force: true });

    const reopened = await openVault(vaultPath, PASSWORD);
    expect(reopened.read('API_KEY')).toBe('v1');
    reopened.close();
  });

  test('a fresh audit log cannot brick a good vault', async () => {
    const vault = await createVault(vaultPath, PASSWORD);
    vault.set('API_KEY', 'v1');
    await vault.save();
    vault.close();

    // Log rotated away / new volume mounted: nothing has been witnessed, so
    // there is nothing to compare against and the vault must still open.
    fs.rmSync(`${vaultPath}.audit.log`, { force: true });

    const reopened = await openVault(vaultPath, PASSWORD);
    expect(reopened.read('API_KEY')).toBe('v1');
    reopened.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Audit caller attribution
// ---------------------------------------------------------------------------
describe('audit lines name the real caller', () => {
  test("defaults to 'vault.js' when no caller is supplied", async () => {
    const vault = await createVault(vaultPath, PASSWORD);
    vault.close();

    expect(auditLines().every((l) => l.caller === 'vault.js')).toBe(true);
  });

  test('a supplied caller reaches every line the handle writes', async () => {
    const vault = await createVault(vaultPath, PASSWORD, { caller: 'adminVault' });
    vault.set('API_KEY', 'v1');
    await vault.save();
    vault.read('API_KEY');
    vault.close();

    const lines = auditLines();
    // open, set, save, read, close — every op, not just the first.
    expect(lines.map((l) => l.op)).toEqual(
      expect.arrayContaining(['open', 'set', 'save', 'read', 'close']),
    );
    expect(lines.every((l) => l.caller === 'adminVault')).toBe(true);
  });

  test('two callers on the same vault stay distinguishable', async () => {
    const cli = await createVault(vaultPath, PASSWORD, { caller: 'vault.js' });
    cli.close();
    const web = await openVault(vaultPath, PASSWORD, { caller: 'adminVault' });
    web.close();

    const callers = new Set(auditLines().map((l) => l.caller));
    expect(callers).toEqual(new Set(['vault.js', 'adminVault']));
  });
});
