'use strict';

/**
 * Build a structurally valid but obviously fake JWT at runtime
 * (base64url(header).base64url(payload).signature), so tests need no
 * literal token strings in source.
 */
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function fixtureJwt(payload, header = { alg: 'RS256', typ: 'JWT' }, signature = 'fake-signature') {
  return `${b64url(header)}.${b64url(payload)}.${signature}`;
}

module.exports = { fixtureJwt };
