'use strict';

/**
 * Mints an unsigned (alg: none) JWT-shaped string for protocol-playground
 * mock routes. Not a real credential — decodable by TokenInspector for
 * teaching purposes, never verified or trusted anywhere else in the app.
 */
function mintDemoJwt(claims) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = { alg: 'none', typ: 'JWT' };
  return `${b64url(header)}.${b64url(claims)}.demo-signature-not-cryptographically-valid`;
}

/**
 * Best-effort decode of a demo JWT's payload. Returns null on any malformed
 * input instead of throwing — callers treat an unreadable token as "unknown".
 */
function decodeDemoJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { mintDemoJwt, decodeDemoJwt };
