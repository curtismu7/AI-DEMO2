'use strict';
// CJS shim for `jose` — used only in Jest (CJS mode) because jose v6 is ESM-only.
// Tests don't exercise real JWT verification end-to-end; production code path is
// covered by integration tests against a live PingOne tenant.
//
// If a Jest test ever needs real JWT behavior, that test should `jest.unmock('jose')`
// and migrate to native ESM via --experimental-vm-modules, not extend this shim.

function createRemoteJWKSet(_url, _options) {
  // Returns a function that resolves a JWK — stub returns a sentinel.
  return async function resolveKey(_header) {
    throw new Error('[jose-cjs shim] createRemoteJWKSet() called in test — mock the caller');
  };
}

async function jwtVerify(_jwt, _keyOrSecret, _options) {
  throw new Error('[jose-cjs shim] jwtVerify() called in test — mock the caller');
}

async function compactDecrypt(_jwe, _keyOrSecret, _options) {
  throw new Error('[jose-cjs shim] compactDecrypt() called in test — mock the caller');
}

async function compactSign(_payload, _key, _options) {
  throw new Error('[jose-cjs shim] compactSign() called in test — mock the caller');
}

/**
 * REAL implementation, not a stub. SigningKeyManager.initialize() calls this on
 * the DemoMCPServer.startServer() path, so every server-lifecycle test reaches
 * it — a throwing stub fails 21 tests with "jose.exportJWK is not a function"
 * rather than surfacing anything about the test's actual subject.
 *
 * Node's KeyObject has exported JWK natively since v15 (this repo is >= 22), so
 * the shim delegates instead of faking. That keeps the derived `kid` a real
 * sha256 over a real JWK, which is what the lifecycle assertions depend on.
 */
async function exportJWK(key) {
  return key.export({ format: 'jwk' });
}

/**
 * Builder stub. Used only by TokenIssuer, which no test currently exercises.
 * The chainable setters return `this` so the failure lands on .sign() with the
 * shim's standard message — without the class, the call site would instead die
 * on "jose.SignJWT is not a constructor", which points at the shim rather than
 * at the missing mock.
 */
class SignJWT {
  constructor(_payload) {
    for (const m of ['setProtectedHeader', 'setIssuer', 'setSubject', 'setAudience',
      'setIssuedAt', 'setExpirationTime', 'setJti', 'setNotBefore']) {
      this[m] = () => this;
    }
  }

  async sign(_key) {
    throw new Error('[jose-cjs shim] SignJWT.sign() called in test — mock the caller');
  }
}

module.exports = {
  createRemoteJWKSet,
  jwtVerify,
  compactDecrypt,
  compactSign,
  exportJWK,
  SignJWT,
};
