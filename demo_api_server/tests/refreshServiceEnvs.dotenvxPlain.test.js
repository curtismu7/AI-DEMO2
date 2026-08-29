'use strict';

/**
 * A GENERATED service .env must never contain dotenvx ciphertext.
 *
 * Only demo_api_server/.env is encrypted at rest. The 11 files
 * refresh-service-envs.js writes are plaintext by design, and most of their
 * consumers cannot decrypt — PingGateway is Groovy inside IG, there is no
 * dotenvx there at all.
 *
 * Found live 2026-08-29: HITL_INTERNAL_SECRET reached ping-gateway/.env as
 * `encrypted:...` (the only ciphertext value in that file) while the BFF and
 * hitl-service both held the plaintext. p1az-decision.groovy's receipt verify
 * 401'd, the filter failed closed — "[P1AZ] HITL verify unavailable (http 401)
 * — failing closed" — and every consent-gated tool answered 503.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { keypair, encrypt } = require('@dotenvx/primitives');
const { writeEnvFile, dotenvxPlain } = require('../scripts/refresh-service-envs');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-envs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeAndRead(vars) {
  const file = path.join(dir, '.env');
  writeEnvFile(file, vars);
  return fs.readFileSync(file, 'utf8');
}

test('plaintext values are written through unchanged', () => {
  const out = writeAndRead({
    HITL_SERVICE_URL: 'http://hitl-service:3009',
    PG_INBOUND_SCOPE: 'gateway:mcp:invoke',
  });
  expect(out).toContain('HITL_SERVICE_URL=http://hitl-service:3009');
  expect(out).toContain('PG_INBOUND_SCOPE=gateway:mcp:invoke');
});

test('RED PROOF — a real encrypted: value is decrypted, not passed through', () => {
  // A real keypair via the same package dotenvxPlain calls — not a hand-written
  // `encrypted:` string, which would only prove the code recognizes a prefix.
  const kp = keypair();
  const cipher = encrypt(kp.publicKey, 'the-shared-hitl-secret');

  expect(cipher.startsWith('encrypted:')).toBe(true);
  expect(dotenvxPlain(cipher, kp.privateKey)).toBe('the-shared-hitl-secret');
});

test('the WRONG key fails closed: ciphertext kept, never an empty secret', () => {
  const kp = keypair();
  const other = keypair();
  const cipher = encrypt(kp.publicKey, 'the-shared-hitl-secret');

  const out = dotenvxPlain(cipher, other.privateKey);
  expect(out).toBe(cipher);
  expect(out).not.toBe('');
});

test('an encrypted: value with no usable key is written through unchanged', () => {
  // Without a decryptable key this documents the fail-safe: the value is passed
  // through rather than mangled or dropped. With the real .env.keys present on
  // a developer machine it is decrypted instead. Either way the file must never
  // silently contain a *different* ciphertext than what was handed in.
  const cipher = 'encrypted:BOGUSNOTREALCIPHERTEXT';
  const out = writeAndRead({ HITL_INTERNAL_SECRET: cipher });
  const line = out.split('\n').find((l) => l.startsWith('HITL_INTERNAL_SECRET='));
  const value = line.slice('HITL_INTERNAL_SECRET='.length).replace(/^"|"$/g, '');

  // Undecryptable input is left exactly as it arrived — never throws, never
  // writes an empty secret (an empty one turns hitl-service's auth off).
  expect(value).toBe(cipher);
  expect(value).not.toBe('');
});

test('an undecryptable value never throws — refresh must not abort the run', () => {
  expect(() => writeAndRead({ SOME_SECRET: 'encrypted:garbage' })).not.toThrow();
});
