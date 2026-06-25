'use strict';

const crypto = require('node:crypto');
const {
  KDF_PARAMS,
  deriveKek,
  aeadSeal,
  aeadOpen,
  hkdfFileHmacKey,
} = require('../../lib/vault/crypto');

// Argon2id parameters in this test module match the FROZEN values in
// lib/vault/crypto.js. Increase Jest's default 5s timeout to accommodate
// 64 MiB / t=3 / p=4 hashes on slower CI runners.
jest.setTimeout(30000);

describe('vault/crypto: KDF_PARAMS', () => {
  test('KDF_PARAMS is Object.freeze\'d (writes throw in strict mode)', () => {
    expect(Object.isFrozen(KDF_PARAMS)).toBe(true);
    expect(() => {
      'use strict';
      KDF_PARAMS.memoryCost = 1;
    }).toThrow(TypeError);
  });

  test('KDF_PARAMS has frozen OWASP-recommended values', () => {
    expect(KDF_PARAMS.memoryCost).toBe(65536);
    expect(KDF_PARAMS.timeCost).toBe(3);
    expect(KDF_PARAMS.parallelism).toBe(4);
    expect(KDF_PARAMS.hashLength).toBe(32);
  });
});

describe('vault/crypto: deriveKek', () => {
  const SALT = crypto.randomBytes(16);

  test('same password + salt yields identical KEK', async () => {
    const a = await deriveKek('p@ssword', SALT);
    const b = await deriveKek('p@ssword', SALT);
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  test('different password yields different KEK', async () => {
    const a = await deriveKek('p@ssword', SALT);
    const b = await deriveKek('p@ssword2', SALT);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  test('different salt yields different KEK', async () => {
    const a = await deriveKek('p@ssword', SALT);
    const otherSalt = crypto.randomBytes(16);
    const b = await deriveKek('p@ssword', otherSalt);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});

describe('vault/crypto: aeadSeal / aeadOpen', () => {
  const KEY = crypto.randomBytes(32);

  test('round-trips a string plaintext', () => {
    const sealed = aeadSeal('hello-world', KEY);
    expect(sealed.iv.length).toBe(12);
    expect(sealed.tag.length).toBe(16);
    const pt = aeadOpen(sealed, KEY);
    expect(pt.toString('utf8')).toBe('hello-world');
  });

  test('round-trips a Buffer plaintext', () => {
    const sealed = aeadSeal(Buffer.from([0, 1, 2, 3, 4]), KEY);
    const pt = aeadOpen(sealed, KEY);
    expect(Buffer.compare(pt, Buffer.from([0, 1, 2, 3, 4]))).toBe(0);
  });

  test('flipping any byte in iv → aeadOpen throws', () => {
    const sealed = aeadSeal('secret', KEY);
    const bad = { ...sealed, iv: Buffer.from(sealed.iv) };
    bad.iv[0] ^= 0xff;
    expect(() => aeadOpen(bad, KEY)).toThrow();
  });

  test('flipping any byte in tag → aeadOpen throws', () => {
    const sealed = aeadSeal('secret', KEY);
    const bad = { ...sealed, tag: Buffer.from(sealed.tag) };
    bad.tag[0] ^= 0xff;
    expect(() => aeadOpen(bad, KEY)).toThrow();
  });

  test('flipping any byte in ct → aeadOpen throws', () => {
    const sealed = aeadSeal('secret', KEY);
    const bad = { ...sealed, ct: Buffer.from(sealed.ct) };
    bad.ct[0] ^= 0xff;
    expect(() => aeadOpen(bad, KEY)).toThrow();
  });

  test('aeadOpen with wrong key throws; message does NOT contain "wrong" or "tampered"', () => {
    const sealed = aeadSeal('secret', KEY);
    const wrongKey = crypto.randomBytes(32);
    let caught;
    try {
      aeadOpen(sealed, wrongKey);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).not.toMatch(/wrong/i);
    expect(caught.message).not.toMatch(/tampered/i);
  });

  test('aeadSeal with key.length !== 32 throws "key must be 32 bytes"', () => {
    const shortKey = crypto.randomBytes(16);
    expect(() => aeadSeal('x', shortKey)).toThrow('key must be 32 bytes');
  });

  test('aeadOpen with iv.length !== 12 throws "iv must be 12 bytes"', () => {
    const bad = {
      iv: crypto.randomBytes(8),
      tag: crypto.randomBytes(16),
      ct: crypto.randomBytes(16),
    };
    expect(() => aeadOpen(bad, KEY)).toThrow('iv must be 12 bytes');
  });

  test('aeadOpen with tag.length !== 16 throws "tag must be 16 bytes"', () => {
    const bad = {
      iv: crypto.randomBytes(12),
      tag: crypto.randomBytes(8),
      ct: crypto.randomBytes(16),
    };
    expect(() => aeadOpen(bad, KEY)).toThrow('tag must be 16 bytes');
  });
});

describe('vault/crypto: hkdfFileHmacKey', () => {
  test('returns a 32-byte Buffer', () => {
    const kek = crypto.randomBytes(32);
    const out = hkdfFileHmacKey(kek);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(32);
  });

  test('deterministic for the same KEK', () => {
    const kek = crypto.randomBytes(32);
    const a = hkdfFileHmacKey(kek);
    const b = hkdfFileHmacKey(kek);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  test('different KEK → different sub-key', () => {
    const a = hkdfFileHmacKey(crypto.randomBytes(32));
    const b = hkdfFileHmacKey(crypto.randomBytes(32));
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
