'use strict';
// CJS shim for jose — jose v6+ ships ESM-only (its package.json "exports" has
// no "require" condition, only "default" pointing at an ESM file), so Jest's
// CJS module loader throws a SyntaxError on `export` when anything requires
// it. No code in this repo requires 'jose' directly; it arrives transitively
// via @a2a-js/sdk's bundled CJS build (dist/index.cjs, dist/server/*.cjs),
// which does `require("jose")` at module scope for its agent-card signature
// helper — a feature this repo does not import or call anywhere. No test in
// this suite exercises real JWS signing/verification, so this shim only
// needs to let `require('jose')` succeed (mirrors the uuid-cjs.js shim below
// for the same class of ESM-only-dependency problem). If a test ever does
// exercise real signing, these throw loudly instead of returning silently
// wrong crypto output.
function notImplemented(name) {
  return () => {
    throw new Error(
      `jose-cjs test shim: "${name}" is not implemented — real JWS signing is not exercised by this test suite`,
    );
  };
}

class FlattenedSign {
  constructor() {}
  setProtectedHeader() {
    return this;
  }
  sign() {
    throw new Error('jose-cjs test shim: FlattenedSign#sign is not implemented');
  }
}

module.exports = {
  FlattenedSign,
  flattenedVerify: notImplemented('flattenedVerify'),
  decodeProtectedHeader: notImplemented('decodeProtectedHeader'),
  base64url: {
    encode: notImplemented('base64url.encode'),
    decode: notImplemented('base64url.decode'),
  },
};
