'use strict';

/**
 * This container has no `.env` file on disk (Dockerfile does not COPY one) —
 * every secret arrives pre-merged into process.env via Docker Compose's
 * `env_file:` mechanism, ciphertext included post-dotenvx-cutover. Found live
 * 2026-08-29: HITL_INTERNAL_SECRET arriving as `encrypted:...` here while the
 * BFF sent the decrypted plaintext made routes/challenges.js answer 401
 * `unauthorized` to every internal caller, so no consent receipt could be
 * created and UC14b's within-cap transfer reported "Human approval required"
 * forever. See src/dotenvxBootstrap.js for the full incident writeup.
 *
 * Fixtures are encrypted with a REAL generated keypair via
 * @dotenvx/primitives — the same package (and the same public `decrypt`
 * export) dotenvxBootstrap.js itself calls — not a hand-written `encrypted:`
 * string, which would only prove the code recognizes a prefix.
 *
 * Jest, not node:test — this service's runner is jest (package.json `test`).
 */

const { keypair, encrypt } = require('@dotenvx/primitives');
const { bootstrapDotenvx } = require('../src/dotenvxBootstrap');

const quiet = { log() {}, error() {} };

let kp;
beforeEach(() => {
  kp = keypair();
});

test('decrypts a real encrypted value in place and clears the private key', () => {
  const env = {
    DOTENV_PRIVATE_KEY: kp.privateKey,
    HITL_INTERNAL_SECRET: encrypt(kp.publicKey, 'super-secret-value'),
  };

  const result = bootstrapDotenvx({ env, logger: quiet });

  expect(result.applied).toBe(1);
  expect(env.HITL_INTERNAL_SECRET).toBe('super-secret-value');
  // the decrypt key must not survive the call
  expect(env.DOTENV_PRIVATE_KEY).toBeUndefined();
});

test('decrypts every encrypted value present, leaves plaintext values untouched', () => {
  const env = {
    DOTENV_PRIVATE_KEY: kp.privateKey,
    HITL_SERVICE_URL: 'http://hitl-service:3009',
    HITL_INTERNAL_SECRET: encrypt(kp.publicKey, 'secret-one'),
    ANOTHER_SECRET: encrypt(kp.publicKey, 'secret-two'),
  };

  const result = bootstrapDotenvx({ env, logger: quiet });

  expect(result.applied).toBe(2);
  expect(env.HITL_SERVICE_URL).toBe('http://hitl-service:3009');
  expect(env.HITL_INTERNAL_SECRET).toBe('secret-one');
  expect(env.ANOTHER_SECRET).toBe('secret-two');
});

test('no DOTENV_PRIVATE_KEY: a no-op, ciphertext left exactly as it arrived', () => {
  const cipher = encrypt(kp.publicKey, 'never-decrypted');
  const env = { HITL_INTERNAL_SECRET: cipher };

  const result = bootstrapDotenvx({ env, logger: quiet });

  expect(result.applied).toBe(0);
  expect(env.HITL_INTERNAL_SECRET).toBe(cipher);
});

test('the WRONG private key fails closed: value stays ciphertext, no throw', () => {
  const otherKp = keypair();
  const env = {
    DOTENV_PRIVATE_KEY: otherKp.privateKey, // does not match the key that encrypted this value
    HITL_INTERNAL_SECRET: encrypt(kp.publicKey, 'secret'),
  };

  // a decrypt failure must never crash boot
  const result = bootstrapDotenvx({ env, logger: quiet });

  expect(result.applied).toBe(0);
  // must remain ciphertext, not a thrown error or undefined
  expect(env.HITL_INTERNAL_SECRET.startsWith('encrypted:')).toBe(true);
});

test('plaintext-only env (no cutover yet) is an exact pass-through', () => {
  const env = { SOME_VAR: 'plain-value' };
  const result = bootstrapDotenvx({ env, logger: quiet });
  expect(result.applied).toBe(0);
  expect(env.SOME_VAR).toBe('plain-value');
});
