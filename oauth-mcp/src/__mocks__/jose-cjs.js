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

// SignJWT / EncryptJWT builder classes are not currently used by source.
// Add stubs if a future import surfaces.

module.exports = {
  createRemoteJWKSet,
  jwtVerify,
  compactDecrypt,
  compactSign,
};
