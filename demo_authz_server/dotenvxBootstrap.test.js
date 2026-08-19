'use strict';

/**
 * This container has no `.env` file on disk (Dockerfile does not COPY one) —
 * every secret arrives pre-merged into process.env via Docker Compose's
 * `env_file:` mechanism, ciphertext included post-dotenvx-cutover. Found live
 * 2026-08-19: PINGONE_WORKER_CLIENT_SECRET arriving as `encrypted:...` made
 * every PingOne user lookup fail with invalid_client, surfacing as
 * `user_lookup_failed` — masking the real cause. See dotenvxBootstrap.js for
 * the full incident writeup.
 *
 * Fixtures are encrypted with a REAL generated keypair via
 * @dotenvx/primitives — the same package (and the same public `decrypt`
 * export) dotenvxBootstrap.js itself calls — not a hand-written `encrypted:`
 * string, which would only prove the code recognizes a prefix.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { keypair, encrypt } = require('@dotenvx/primitives');
const { bootstrapDotenvx } = require('./dotenvxBootstrap');

let kp;
beforeEach(() => {
  kp = keypair();
});

function fakeEnv(overrides) {
  return Object.assign({}, overrides);
}

test('decrypts a real encrypted value in place and clears the private key', () => {
  const env = fakeEnv({
    DOTENV_PRIVATE_KEY: kp.privateKey,
    PINGONE_WORKER_CLIENT_SECRET: encrypt(kp.publicKey, 'super-secret-value'),
  });

  const result = bootstrapDotenvx({ env, logger: { log() {}, error() {} } });

  assert.strictEqual(result.applied, 1);
  assert.strictEqual(env.PINGONE_WORKER_CLIENT_SECRET, 'super-secret-value');
  assert.strictEqual(env.DOTENV_PRIVATE_KEY, undefined, 'the decrypt key must not survive the call');
});

test('decrypts every encrypted value present, leaves plaintext values untouched', () => {
  const env = fakeEnv({
    DOTENV_PRIVATE_KEY: kp.privateKey,
    PINGONE_WORKER_CLIENT_ID: 'plain-client-id',
    PINGONE_WORKER_CLIENT_SECRET: encrypt(kp.publicKey, 'secret-one'),
    ANOTHER_SECRET: encrypt(kp.publicKey, 'secret-two'),
  });

  const result = bootstrapDotenvx({ env, logger: { log() {}, error() {} } });

  assert.strictEqual(result.applied, 2);
  assert.strictEqual(env.PINGONE_WORKER_CLIENT_ID, 'plain-client-id');
  assert.strictEqual(env.PINGONE_WORKER_CLIENT_SECRET, 'secret-one');
  assert.strictEqual(env.ANOTHER_SECRET, 'secret-two');
});

test('no DOTENV_PRIVATE_KEY: a no-op, ciphertext left exactly as it arrived', () => {
  const cipher = encrypt(kp.publicKey, 'never-decrypted');
  const env = fakeEnv({ PINGONE_WORKER_CLIENT_SECRET: cipher });

  const result = bootstrapDotenvx({ env, logger: { log() {}, error() {} } });

  assert.strictEqual(result.applied, 0);
  assert.strictEqual(env.PINGONE_WORKER_CLIENT_SECRET, cipher);
});

test('the WRONG private key fails closed: value stays ciphertext, no throw', () => {
  const otherKp = keypair();
  const env = fakeEnv({
    DOTENV_PRIVATE_KEY: otherKp.privateKey, // does not match the key that encrypted this value
    PINGONE_WORKER_CLIENT_SECRET: encrypt(kp.publicKey, 'secret'),
  });

  let threw = false;
  let result;
  try {
    result = bootstrapDotenvx({ env, logger: { log() {}, error() {} } });
  } catch (_err) {
    threw = true;
  }

  assert.strictEqual(threw, false, 'a decrypt failure must never crash boot');
  assert.strictEqual(result.applied, 0);
  assert.ok(env.PINGONE_WORKER_CLIENT_SECRET.startsWith('encrypted:'), 'must remain ciphertext, not a thrown error or undefined');
});

test('plaintext-only env (no cutover yet, or @dotenvx/primitives absent) is an exact pass-through', () => {
  const env = fakeEnv({ SOME_VAR: 'plain-value' });
  const result = bootstrapDotenvx({ env, logger: { log() {}, error() {} } });
  assert.strictEqual(result.applied, 0);
  assert.strictEqual(env.SOME_VAR, 'plain-value');
});
