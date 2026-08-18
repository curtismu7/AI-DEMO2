'use strict';

const crypto = require('node:crypto');
const { aeadSeal, aeadOpen } = require('../lib/aead');

describe('lib/aead: aeadSeal / aeadOpen', () => {
  const KEY = crypto.randomBytes(32);

  test('seal -> open round-trip returns the original plaintext', () => {
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

  test('aeadOpen with a wrong 32-byte key throws', () => {
    const sealed = aeadSeal('secret', KEY);
    const wrongKey = crypto.randomBytes(32);
    expect(() => aeadOpen(sealed, wrongKey)).toThrow();
  });

  test('aeadOpen with a tampered tag throws', () => {
    const sealed = aeadSeal('secret', KEY);
    const bad = { ...sealed, tag: Buffer.from(sealed.tag) };
    bad.tag[0] ^= 0xff;
    expect(() => aeadOpen(bad, KEY)).toThrow();
  });

  test('aeadSeal guard: key.length !== 32 throws "key must be 32 bytes"', () => {
    const shortKey = crypto.randomBytes(16);
    expect(() => aeadSeal('x', shortKey)).toThrow('key must be 32 bytes');
  });

  test('aeadOpen guard: key.length !== 32 throws "key must be 32 bytes"', () => {
    const sealed = aeadSeal('secret', KEY);
    const shortKey = crypto.randomBytes(16);
    expect(() => aeadOpen(sealed, shortKey)).toThrow('key must be 32 bytes');
  });

  test('aeadOpen guard: iv.length !== 12 throws "iv must be 12 bytes"', () => {
    const bad = {
      iv: crypto.randomBytes(8),
      tag: crypto.randomBytes(16),
      ct: crypto.randomBytes(16),
    };
    expect(() => aeadOpen(bad, KEY)).toThrow('iv must be 12 bytes');
  });

  test('aeadOpen guard: tag.length !== 16 throws "tag must be 16 bytes"', () => {
    const bad = {
      iv: crypto.randomBytes(12),
      tag: crypto.randomBytes(8),
      ct: crypto.randomBytes(16),
    };
    expect(() => aeadOpen(bad, KEY)).toThrow('tag must be 16 bytes');
  });
});
