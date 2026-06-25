'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  parseEnvelope,
  verifyFileHmac,
} = require('../../lib/vault/format');
const { deriveKek, hkdfFileHmacKey } = require('../../lib/vault/crypto');

const FIXTURES = path.join(__dirname, 'fixtures');
const VALID = path.join(FIXTURES, 'valid-v1.vault');
const CORRUPTED = path.join(FIXTURES, 'corrupted-v1.vault');
const PASSWORD = 'golden-test-password';

// Argon2id KDF takes ~300ms on dev hardware; allow 30s for CI.
jest.setTimeout(30000);

describe('vault/golden: valid-v1.vault', () => {
  test('parseEnvelope succeeds; magic=BNKV, version=1', () => {
    const buf = fs.readFileSync(VALID);
    const env = parseEnvelope(buf);
    expect(env.magic).toBe('BNKV');
    expect(env.version).toBe(1);
    expect(env.kdf.alg).toBe('argon2id');
    expect(env.kdf.memCost).toBe(65536);
    expect(env.kdf.timeCost).toBe(3);
    expect(env.kdf.parallelism).toBe(4);
    expect(env.kdf.hashLen).toBe(32);
    expect(env.entries.GREETING).toBeDefined();
    expect(env.entries.NOTE).toBeDefined();
  });

  test('with password "golden-test-password", deriving KEK + verifying fileHmac succeeds', async () => {
    const buf = fs.readFileSync(VALID);
    const env = parseEnvelope(buf);
    const salt = Buffer.from(env.kdf.salt, 'base64');
    const kek = await deriveKek(PASSWORD, salt);
    const hmacKey = hkdfFileHmacKey(kek);
    expect(verifyFileHmac(env, hmacKey)).toBe(true);
  });
});

describe('vault/golden: corrupted-v1.vault', () => {
  test('parseEnvelope still succeeds (file is still valid JSON)', () => {
    const buf = fs.readFileSync(CORRUPTED);
    const env = parseEnvelope(buf);
    expect(env.magic).toBe('BNKV');
    expect(env.version).toBe(1);
  });

  test('with correct password, verifyFileHmac returns false (corruption detected)', async () => {
    const buf = fs.readFileSync(CORRUPTED);
    const env = parseEnvelope(buf);
    const salt = Buffer.from(env.kdf.salt, 'base64');
    const kek = await deriveKek(PASSWORD, salt);
    const hmacKey = hkdfFileHmacKey(kek);
    expect(verifyFileHmac(env, hmacKey)).toBe(false);
  });
});
