'use strict';

/**
 * @file intentTokenService.ciphertextKey.test.js
 * @description The intent-token signing key must never be configStore ciphertext.
 *
 * `encrypted:...` is configStore's own at-rest format. configStore SKIPS such a
 * value when it turns up in .env (the 2026-08-21 invalid_client incident — see
 * docs/vault.md), but intentTokenService reads `process.env` directly, so nothing
 * stopped the BFF signing every intent token with the literal ciphertext string.
 *
 * It is undetectable from the signing side: an HMAC key is just bytes, so the
 * signature it produces is perfectly valid. Only the VERIFIERS fail — and
 * silently, because they were handed the real secret and can never match a key
 * derived from ciphertext. Both gateway verifiers ran as dead code for weeks:
 *
 *   Node gateway  IntentTokenError: "no_signing_key"      (visible)
 *   PingGateway   invalid_signature                       (silent)
 *
 * A signing key that cannot be resolved is a configuration error, not a usable
 * secret, so it must fail loudly at the point of use.
 */

const ENV_KEYS = ['INTENT_TOKEN_SECRET', 'SESSION_SECRET'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  jest.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const load = () => require('../../services/intentTokenService');

const mint = (svc) => svc.mintIntentToken({
  userId: 'user-1',
  sessionId: 'sess-1',
  prompt: 'show my balance',
  intent: 'view_balance',
  confidence: 0.97,
  vertical: 'banking',
});

describe('intent-token signing key', () => {
  it('signs normally with a real dedicated secret', () => {
    process.env.INTENT_TOKEN_SECRET = 'a-real-dedicated-secret-value';
    const svc = load();
    expect(() => mint(svc)).not.toThrow();
  });

  // The regression.
  it('THROWS when INTENT_TOKEN_SECRET is configStore ciphertext', () => {
    process.env.INTENT_TOKEN_SECRET = 'encrypted:AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const svc = load();
    expect(() => mint(svc)).toThrow(/ciphertext/i);
  });

  // The actual production shape: no dedicated key, SESSION_SECRET carrying the
  // vault ciphertext. This is what was live and silently signing.
  it('THROWS when it falls back to a ciphertext SESSION_SECRET', () => {
    process.env.SESSION_SECRET = 'encrypted:BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const svc = load();
    expect(() => mint(svc)).toThrow(/ciphertext|encrypted:/i);
  });

  it('names the fix in the error, not just the fault', () => {
    process.env.SESSION_SECRET = 'encrypted:CCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const svc = load();
    let msg = '';
    try { mint(svc); } catch (e) { msg = e.message; }
    expect(msg).toMatch(/INTENT_TOKEN_SECRET/);
    expect(msg).toMatch(/refresh-service-envs/);
  });

  it('still throws the original error when no key is configured at all', () => {
    const svc = load();
    expect(() => mint(svc)).toThrow(/not set/i);
  });
});
