'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Verifies a JWT against a JWKS document, the same check Privilege's
 * "Fetch from URL" key source performs. Pure — no network calls.
 * @param {string} token
 * @param {{keys: object[]}} jwks
 * @returns {{valid: boolean, claims?: object, error?: string}}
 */
function verifyToken(token, jwks) {
  const decodedHeader = jwt.decode(token, { complete: true })?.header;
  if (!decodedHeader?.kid) {
    return { valid: false, error: 'token has no kid header' };
  }

  const jwk = jwks.keys.find((key) => key.kid === decodedHeader.kid);
  if (!jwk) {
    return { valid: false, error: `no key in JWKS matches kid "${decodedHeader.kid}"` };
  }

  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    return { valid: true, claims };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

async function main() {
  const [jwksUrl, token] = process.argv.slice(2);
  if (!jwksUrl || !token) {
    console.error('Usage: node verifyClusterToken.js <jwksUrl> <token>');
    process.exit(2);
  }

  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch JWKS: HTTP ${response.status}`);
  }
  const jwks = await response.json();
  const result = verifyToken(token, jwks);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { verifyToken };
