'use strict';

const crypto = require('node:crypto');
const {
  MAGIC,
  VERSION,
  canonicalJson,
  serializeEnvelope,
  parseEnvelope,
  computeFileHmac,
  verifyFileHmac,
} = require('../../lib/vault/format');
const { VaultIntegrityError } = require('../../lib/vault/errors');

describe('vault/format: constants', () => {
  test('MAGIC is "BNKV"', () => {
    expect(MAGIC).toBe('BNKV');
  });

  test('VERSION is 1', () => {
    expect(VERSION).toBe(1);
  });
});

describe('vault/format: canonicalJson', () => {
  test('sorts object keys alphabetically at the top level', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('sorts nested object keys alphabetically', () => {
    const out = canonicalJson({ b: 1, a: { z: 1, y: 2 } });
    expect(out).toBe('{"a":{"y":2,"z":1},"b":1}');
  });

  test('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  test('handles primitives via JSON.stringify', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('vault/format: serializeEnvelope', () => {
  test('returns a UTF-8 Buffer of canonicalJson(obj)', () => {
    const obj = { b: 1, a: 2 };
    const buf = serializeEnvelope(obj);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('{"a":2,"b":1}');
  });
});

describe('vault/format: parseEnvelope', () => {
  const VALID_KDF = {
    alg: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    memCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLen: 32,
  };

  test('parses a valid envelope', () => {
    const env = { magic: 'BNKV', version: 1, kdf: VALID_KDF, entries: {} };
    const buf = serializeEnvelope(env);
    const out = parseEnvelope(buf);
    expect(out.magic).toBe('BNKV');
    expect(out.version).toBe(1);
  });

  test('throws VaultIntegrityError on magic mismatch', () => {
    const env = { magic: 'NOPE', version: 1 };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(VaultIntegrityError);
    expect(() => parseEnvelope(buf)).toThrow(
      /vault: unrecognized format \(magic mismatch\)/,
    );
  });

  test('throws VaultIntegrityError on unsupported version', () => {
    const env = { magic: 'BNKV', version: 99 };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(VaultIntegrityError);
    expect(() => parseEnvelope(buf)).toThrow(/vault: format version 99 not supported/);
  });

  test('throws VaultIntegrityError on invalid JSON', () => {
    expect(() => parseEnvelope(Buffer.from('not json'))).toThrow(VaultIntegrityError);
  });

  // WR-01: KDF param validation fires BEFORE deriveKek runs.
  test('throws VaultIntegrityError when kdf block is missing', () => {
    const env = { magic: 'BNKV', version: 1, entries: {} };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(VaultIntegrityError);
    expect(() => parseEnvelope(buf)).toThrow(/missing kdf block/);
  });

  test('throws VaultIntegrityError when kdf.memCost is downgraded', () => {
    const env = {
      magic: 'BNKV', version: 1,
      kdf: { ...VALID_KDF, memCost: 1 },
      entries: {},
    };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(VaultIntegrityError);
    expect(() => parseEnvelope(buf)).toThrow(/unsupported kdf parameters/);
  });

  test('throws VaultIntegrityError when kdf.timeCost is downgraded', () => {
    const env = {
      magic: 'BNKV', version: 1,
      kdf: { ...VALID_KDF, timeCost: 1 },
      entries: {},
    };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(/unsupported kdf parameters/);
  });

  test('throws VaultIntegrityError when kdf.alg differs', () => {
    const env = {
      magic: 'BNKV', version: 1,
      kdf: { ...VALID_KDF, alg: 'scrypt' },
      entries: {},
    };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(/unsupported kdf parameters/);
  });

  test('throws VaultIntegrityError when kdf.salt is missing', () => {
    const { salt: _drop, ...kdfNoSalt } = VALID_KDF;
    const env = { magic: 'BNKV', version: 1, kdf: kdfNoSalt, entries: {} };
    const buf = serializeEnvelope(env);
    expect(() => parseEnvelope(buf)).toThrow(/missing kdf salt/);
  });
});

describe('vault/format: computeFileHmac / verifyFileHmac', () => {
  const HKEY = crypto.randomBytes(32);

  function makeEnv() {
    return {
      magic: 'BNKV',
      version: 1,
      kdf: {
        alg: 'argon2id',
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        memCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLen: 32,
      },
      createdAt: '2026-05-13T00:00:00Z',
      rotatedAt: null,
      entries: {
        FOO: {
          wrappedDek: 'd2RrYmFzZTY0',
          valueIv: 'aXZiYXNlNjQ=',
          valueTag: 'dGFnYmFzZTY0',
          value: 'dmFsYmFzZTY0',
          updatedAt: '2026-05-13T00:00:00Z',
        },
      },
    };
  }

  test('computeFileHmac is deterministic for the same input', () => {
    const env = makeEnv();
    const a = computeFileHmac(env, HKEY);
    const b = computeFileHmac(env, HKEY);
    expect(a).toBe(b);
  });

  test('verifyFileHmac returns true for a freshly-computed HMAC', () => {
    const env = makeEnv();
    env.fileHmac = computeFileHmac(env, HKEY);
    expect(verifyFileHmac(env, HKEY)).toBe(true);
  });

  test('verifyFileHmac returns false after one-byte flip in createdAt', () => {
    const env = makeEnv();
    env.fileHmac = computeFileHmac(env, HKEY);
    env.createdAt = '2026-05-13T00:00:01Z'; // changed
    expect(verifyFileHmac(env, HKEY)).toBe(false);
  });

  test('verifyFileHmac returns false after one-byte flip in entries.FOO.value', () => {
    const env = makeEnv();
    env.fileHmac = computeFileHmac(env, HKEY);
    env.entries.FOO.value = 'cmFsYmFzZTY0'; // first char flipped
    expect(verifyFileHmac(env, HKEY)).toBe(false);
  });

  test('verifyFileHmac returns false when fileHmac is missing', () => {
    const env = makeEnv();
    expect(verifyFileHmac(env, HKEY)).toBe(false);
  });

  test('verifyFileHmac uses timingSafeEqual (different lengths return false)', () => {
    const env = makeEnv();
    env.fileHmac = 'AAAA'; // short, wrong-length b64
    expect(verifyFileHmac(env, HKEY)).toBe(false);
  });
});
